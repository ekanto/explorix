# Explorix Reporting

Explorix turns stored findings, sessions, charters and evidence into professional reports in **Word (DOCX)**, **PDF**, **Markdown** and **HTML**, optionally as a self-contained **evidence package**. Reports are built only from real data. Sections with nothing to show are left out, and no placeholder text is invented.

Open the wizard from *Reports → New report*, from **File → New Report…** (Ctrl+Shift+R), or from the *Report* action on a finding, session or charter.

## The wizard

| Step | What you choose |
|---|---|
| 1. Scope | A single finding, several findings, a session, a charter with all of its sessions, a milestone/release, or the whole project |
| 2. Template | One of the eight built-in templates or a saved template; one or more output formats; the evidence package mode |
| 3. Content | Which findings and which evidence items to include (with thumbnails); severity filter; date range; screenshots, videos and attachments on or off; whether to prefer annotated screenshots |
| 4. Layout | Sections, title, subtitle, author, organisation, logo, accent colour, confidentiality notice, portrait/landscape, image size (small/medium/large), metadata tables, comments. *Save as template* stores these settings for reuse. |
| 5. Preview | A live HTML preview of the exact report model, rendered in a sandboxed frame |
| 6. Generate | Progress with a **Cancel** button, any evidence warnings, then **Save as…** for each output (desktop) or **Download** (browser) |

After saving you can **Open** the report, **Show in folder**, or **Generate another format** with the same settings.

### Saving and overwrite protection (desktop)

- The native Windows **Save As** dialog suggests a name such as `Explorix_Session_Report_2026-10-25.pdf` (pattern `Explorix_<Template>_<date>`).
- If the file already exists, Windows asks first. For folders (Markdown/HTML reports and packages), Explorix asks **Replace / Keep both / Cancel**. *Keep both* saves as `… (2)`. *Replace* moves the old folder aside and deletes it only once the new one is in place.
- Files are copied next to the destination under a temporary name and then renamed. A cancelled, failed or interrupted save never leaves a half-written report.
- Generation checks free disk space first and reports a clear error if there is not enough.

## Templates

| Template | Focus | Default sections |
|---|---|---|
| Exploratory Session Report | One or more sessions | Everything except test execution |
| Detailed Bug Investigation Report | Selected findings in depth | Cover, summary, metadata, environment, findings, videos, outstanding issues, recommendations, evidence index. Large images. |
| Project QA Summary | Project-wide quality | Adds a table of contents, test execution, risks and assessment. Small images. |
| Release Readiness Report | A milestone/release | Like the project summary; defaults to Major, Critical and Blocker findings |
| Regression Testing Report | Manual and automated runs plus regressions found while exploring | Test execution, findings, outstanding issues, assessment |
| Security Testing Findings Report | Security findings | Mission, scope, environment, findings, videos, risks, recommendations, appendices. Confidentiality notice preset. |
| Evidence Collection Report | Evidence catalogue | Screenshots, videos and attachments with captions, timestamps and SHA-256 checksums. Large images. |
| Custom Report | Anything | All sections; you choose |

The available sections are:
- cover page and table of contents;
- executive summary; project and session metadata; charter and mission; scope, exclusions and assumptions; test environment; session timeline and time spent;
- test execution summary; findings summary; detailed findings;
- screenshot evidence; video evidence and important timestamps; additional attachments;
- risks and unresolved questions; outstanding issues; recommended actions; final assessment;
- evidence index and appendices.

Each detailed finding shows:
- ID, title, classification, severity, priority, status, author, owner and timestamp;
- description, preconditions, reproduction steps, expected and actual behaviour, environment and browser;
- screenshots placed **directly under the finding** with numbered references (E1, E2 …) and captions;
- video references, the related issue and requirement, follow-up and resolution notes, and comments (optional).

Saved templates are stored in the local database per project. Built-in templates cannot be changed, but you can save a customised copy.

## Formats

All four renderers consume the same structured report model (`apps/server/src/reporting/model.ts`), so every format contains the same findings and evidence.

| Format | Output | Notes |
|---|---|---|
| **DOCX** | One `.docx` file | Editable Word document with heading styles, a cover page, a table of contents field, page numbers, headers and footers, tables and sized images with captions. Rows don't split across pages, and images stay with their captions. |
| **PDF** | One `.pdf` file | Printed from HTML by Chromium: Electron `printToPDF` on desktop, Playwright on a server. Text is searchable and selectable. Includes a cover, a table of contents, page numbers, headers and footers, and severity badges. Images are scaled to the page and never split; long text flows across pages. |
| **Markdown** | Folder: `<name>/<name>.md` + `evidence/` | Proper heading levels, a table of contents and tables. Reproduction steps are numbered lists and code is kept in code blocks. Images are `![…](evidence/…)` and videos/attachments are relative links. |
| **HTML** | Folder: `<name>/<name>.html` + `evidence/` | A standalone page with all styles inline and no scripts or remote assets, so it works offline. Videos play inline when the codec is supported. |

When Markdown and HTML are both selected, they share one folder and one `evidence/` directory.

### How video is represented

Video is never silently left out. If a video can't be previewed (for example a MOV with an unsupported codec), the report says so and a warning is shown after generation.

| Format | Representation |
|---|---|
| DOCX | Title, filename, description, duration, a thumbnail (or the first selected frame), up to several selected frames, a table of important timestamps with labels and notes, and the evidence reference. Word can't play video reliably, so it isn't embedded. |
| PDF | Same as DOCX. In a package, the filename is given as the relative path `evidence/E3-recording.webm` next to the PDF. |
| Markdown | The preview image plus a relative link to the original video in `evidence/`, with a table of timestamps |
| HTML | An inline `<video>` player pointing at the original in `evidence/`, plus a poster image and timestamps |

Thumbnails and frames are captured in the app with the built-in Chromium video decoder when you attach a video or pick frames. They are stored as separate derivative images, and the original video is never changed.

## Evidence packages

Choose **Report package folder** or **Report package (ZIP)** in step 2. The package contains:

```
Explorix_Session_Report_2026-10-25/
├── Explorix_Session_Report_2026-10-25.pdf    (each selected format)
├── Explorix_Session_Report_2026-10-25.docx
├── Explorix_Session_Report_2026-10-25.md
├── Explorix_Session_Report_2026-10-25.html
├── evidence/
│   ├── E1-login-error.png                    original, byte-for-byte
│   ├── E3-checkout-recording.webm            original video
│   └── previews/                             report-sized copies, thumbnails, frames
├── manifest.json                             every item: ref, finding, file, size, SHA-256, markers, previews
└── README.md                                 structure, how video is represented, how to verify checksums
```

- Links in every format are **relative**, so the package keeps working after you move it or copy it to another computer. The e2e tests resolve every link.
- Only the selected evidence is included. Database files, settings, credentials and application-data paths never appear in reports or packages; the e2e tests scan for them.
- Report copies of images are resized for documents. **Originals are never compressed or modified.**
- Without a package, PDF and DOCX embed screenshots and refer to videos and attachments by name and reference number.

## Limitations

- Reports are English only.
- The PDF page header also appears on the cover page.
- In PDFs, evidence references are text paths, not clickable file links.
- The HTML table of contents has no page numbers. The DOCX table of contents is a Word field: Word fills it in when you open the document (choose *Yes* to update fields).
- Markdown formatting inside descriptions is shown as plain text in DOCX and PDF.
- Video frames come from the built-in Chromium decoder. Codecs it can't decode (HEVC, ProRes) get no thumbnail, and the report says so.
