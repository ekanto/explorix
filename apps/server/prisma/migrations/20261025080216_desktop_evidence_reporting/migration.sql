-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "EvidenceDerivation" AS ENUM ('ANNOTATED', 'FRAME', 'THUMBNAIL');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('SESSION', 'BUG_INVESTIGATION', 'PROJECT_SUMMARY', 'RELEASE_READINESS', 'REGRESSION', 'SECURITY', 'EVIDENCE', 'CUSTOM');

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "derivation" "EvidenceDerivation",
ADD COLUMN     "derivedFromId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "durationSeconds" DOUBLE PRECISION,
ADD COLUMN     "frameTimeSeconds" DOUBLE PRECISION,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "includeInReports" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "kind" "EvidenceKind" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "label" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "browser" TEXT,
ADD COLUMN     "followUp" TEXT,
ADD COLUMN     "preconditions" TEXT,
ADD COLUMN     "resolution" TEXT;

-- CreateTable
CREATE TABLE "VideoMarker" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "timeSeconds" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "frameId" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoMarker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "description" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT,
    "title" TEXT NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "formats" TEXT[],
    "scope" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "findingCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoMarker_attachmentId_idx" ON "VideoMarker"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportTemplate_orgId_name_key" ON "ReportTemplate"("orgId", "name");

-- CreateIndex
CREATE INDEX "ReportRun_projectId_createdAt_idx" ON "ReportRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Attachment_derivedFromId_idx" ON "Attachment"("derivedFromId");

-- CreateIndex
CREATE INDEX "Attachment_projectId_deletedAt_idx" ON "Attachment"("projectId", "deletedAt");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_derivedFromId_fkey" FOREIGN KEY ("derivedFromId") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMarker" ADD CONSTRAINT "VideoMarker_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMarker" ADD CONSTRAINT "VideoMarker_frameId_fkey" FOREIGN KEY ("frameId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMarker" ADD CONSTRAINT "VideoMarker_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill evidence kind and per-target ordering for existing attachments.
UPDATE "Attachment" SET "kind" = CASE
  WHEN "mimeType" LIKE 'image/%' THEN 'IMAGE'::"EvidenceKind"
  WHEN "mimeType" LIKE 'video/%' THEN 'VIDEO'::"EvidenceKind"
  WHEN "mimeType" IN ('application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml') THEN 'DOCUMENT'::"EvidenceKind"
  ELSE 'OTHER'::"EvidenceKind" END;
UPDATE "Attachment" a SET "position" = o.rn FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY COALESCE("findingId", ''), COALESCE("sessionId", ''), COALESCE("issueId", '') ORDER BY "createdAt") - 1 AS rn FROM "Attachment"
) o WHERE a."id" = o."id";
