# Explorix production image (API + built web app served by Express).
# NOTE: authored without a local Docker engine; see docs/DEPLOYMENT.md.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN npm ci --workspace=@explorix/server --workspace=@explorix/web --include-workspace-root
COPY apps ./apps
RUN npx --workspace=@explorix/server prisma generate \
 && npm run build -w @explorix/web \
 && npm run build -w @explorix/server

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=4000 \
    USE_EMBEDDED_PG=false \
    STORAGE_DIR=/data/uploads
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN npm ci --omit=dev --workspace=@explorix/server --include-workspace-root \
 && npm cache clean --force
COPY apps/server/prisma ./apps/server/prisma
RUN npx --workspace=@explorix/server prisma generate
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
WORKDIR /app/apps/server
EXPOSE 4000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
