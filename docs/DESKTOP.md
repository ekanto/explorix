# Explorix Desktop for Windows

Explorix Desktop 3.0 is a standalone Windows application. It bundles everything it needs:
- the Electron runtime;
- the Explorix server;
- an embedded PostgreSQL 18 database;
- the web UI.

You don't need Node.js, a terminal, a browser or an internet connection. All data stays on your computer unless you export it or set up an integration.

## Install

| File | Use it when |
|---|---|
| `Explorix-Setup-3.0.0.exe` (≈ 168 MB) | **Recommended.** Per-user installer. Needs no administrator rights. Creates Start menu and desktop shortcuts, appears in *Apps & features* and can be uninstalled normally. You can choose the install folder. |
| `Explorix-Portable-3.0.0.exe` (≈ 137 MB) | Runs without installing (for example from a USB stick). It unpacks itself to a temporary folder on **every** launch, so start-up takes about a minute. Data is still kept in `%APPDATA%\Explorix`. |

> **The installer is not code-signed.** No signing certificate was available. Windows SmartScreen may show "Windows protected your PC". Choose **More info → Run anyway**. To sign a build, set `CSC_LINK` / `CSC_KEY_PASSWORD` before running `npm run dist:win` (see [electron-builder code signing](https://www.electron.build/code-signing)).

Silent install for IT deployment: `Explorix-Setup-3.0.0.exe /S` (optionally `/D=C:\path\to\folder` as the last argument). Silent uninstall: `"%LOCALAPPDATA%\Programs\Explorix\Uninstall Explorix.exe" /S /currentuser`.

### First launch

1. A splash window shows progress. The first launch creates the local database (a few seconds; up to about 40 s on a slow disk). Later launches take a few seconds.
2. Create the workspace owner: workspace name, your name, email and password. Explorix is multi-user, so you can invite colleagues who share this computer from *Administration → Users*.
3. Start with an empty workspace or click **Load sample project** to explore a realistic project with charters, sessions, findings and evidence.

Explorix shows the sign-in screen every time it starts; sessions are not remembered across restarts.

## Where your data is stored

| What | Location |
|---|---|
| Everything (default) | `%APPDATA%\Explorix` |
| Database (embedded PostgreSQL cluster) | `%APPDATA%\Explorix\data\pg` |
| Evidence (screenshots, videos, attachments) | `%APPDATA%\Explorix\evidence`. You can move it under *Desktop settings → Move evidence folder…*. Explorix restarts, copies and verifies every file, then switches. The old folder is kept until you delete it. |
| Backups | `%APPDATA%\Explorix\backups` |
| Logs | `%APPDATA%\Explorix\logs` (`desktop.log`, `explorix.log`, `postgres.log`) |
| Settings | `%APPDATA%\Explorix\settings.json`. Secrets in it are encrypted with Windows DPAPI. |

Open any of these from **File → Open Data/Evidence/Logs Folder**, from **Help → Where Is My Data?**, or from the **Desktop settings** page.

- **Updates** never touch this folder. Before an update changes the database structure, Explorix takes an automatic safety backup.
- **Uninstalling keeps your data.** To remove it completely, delete `%APPDATA%\Explorix` after uninstalling.
- The database stores evidence by **relative path** plus metadata (size, SHA-256 checksum, dimensions, duration). Media files are never stored inside database rows.
- The *data version* (the latest database migration) is tracked separately from the application version. Both appear in **Help → About Explorix**.

## Backups and restore

*Administration → Backups* (or **File → Backups…**), available to organisation admins.

- **Create backup.** Writes a ZIP to the backups folder. It contains:
  - a consistent snapshot of every table, taken in one database transaction;
  - every evidence file, each with a SHA-256 checksum;
  - `explorix-backup.json`, which records the data version.

  Use **Save a copy…** to put a backup somewhere else, for example a USB drive.
- **Restore.** Choose a backup, then type `RESTORE` to confirm.
  1. Explorix first takes a safety backup of the current state.
  2. It verifies every checksum before changing anything.
  3. It replaces the database in a single transaction and restores the evidence files.
  4. Everyone must sign in again.
- **Automatic backups:** one before every database upgrade. *Desktop settings → Automatic backups to keep* controls how many are kept (default 10).
- Backups from a **newer** Explorix version are refused. Backups from older versions are upgraded after restoring.

Backups contain the workspace's user accounts and password hashes. Store them as carefully as the computer itself. Integration secrets (GitHub tokens, AI keys) are encrypted with a key that never leaves this computer, so you must re-enter them after restoring on a different computer.

## Recovery

If Explorix cannot start, it opens a recovery window instead of hanging. The window shows the error and these options:
- **Retry**;
- **Restore a backup**;
- **Start with an empty database**: the old database and evidence are *moved aside*, never deleted;
- **Open logs** or **Open the data folder**;
- **Quit**.

Specific situations:
- A PostgreSQL process left behind by a crash is stopped automatically on the next start.
- A failed database upgrade leaves the data unchanged, and a backup taken just before the upgrade is available.
- A corrupt `settings.json` is renamed `settings.json.corrupt-<time>` and defaults are used.
- An interrupted report generation leaves no partial files at the destination. Reports are written beside the destination and renamed into place only when complete. Interrupted work files are cleaned up on the next start.

## Evidence

Screenshots, screen recordings and other files can be attached to findings, sessions, issues and test results:
- with the Windows file picker or by drag and drop;
- by pasting from the clipboard (**Ctrl+V**);
- with **Capture screen…**, which takes a screenshot or a recording of a screen or window.

| Type | Formats | Default size limit |
|---|---|---|
| Images | PNG, JPEG, WebP, GIF | 25 MB |
| Videos | MP4, WebM, MOV (playback depends on the codec: H.264/VP8/VP9/AV1 play; HEVC/ProRes MOV is stored but may not preview) | 2 GB |
| Documents and logs | PDF, ZIP, TXT, LOG, MD, CSV, JSON, HAR, XML | 50 MB |

- **Validation.** Types are detected from the file **content** (magic bytes), never from the extension or the browser's MIME type. Text files must be valid UTF-8. SVG, HTML and executables are rejected with an explanation.
- **Size limits** can be changed in *Desktop settings*.
- **Large uploads** are streamed to disk, never loaded into memory.
- **Originals are never modified.** Annotations (arrows, rectangles, highlights, text), selected video frames and thumbnails are stored as separate *derivatives* linked to the original.
- **Per-item options:** reorder, rename the display label, add a caption, mark important video moments (timestamps with notes), and **exclude from reports** without deleting the file.
- **Retention:**
  - Deleted evidence goes to the project's *Evidence trash*. It can be restored for 30 days and is then purged.
  - Findings and sessions are archived or dismissed, never hard-deleted, so their evidence is never orphaned.
  - Deleting an automation run removes its attachment files together with the rows.
  - Uploads interrupted for more than an hour are discarded on the next start.

## Reports

See [REPORTING.md](REPORTING.md). Reports are generated in Word (DOCX), PDF, Markdown and HTML, optionally as a self-contained evidence package, and saved with the native Windows **Save As** dialog. Existing files are never overwritten without confirmation.

## Security

| Control | Implementation |
|---|---|
| Renderer isolation | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true` on every window |
| Narrow API | The preload exposes only `window.explorixDesktop`: 15 named functions (app info, open folder, open external link, save report, open/show saved report, capture sources/screenshot/recording source, save/restore backup, get/set settings, choose evidence folder) plus a menu-navigation listener. There is no generic filesystem or IPC access. |
| IPC validation | Every channel has a zod schema (`apps/desktop/src/contract.ts`). Calls are accepted only from the top-level Explorix page (origin check). Every call except app info requires a signed-in user, and admin-only calls check the role in the main process. |
| File access | The renderer never sends paths. Saving uses job IDs (UUIDs) and folder actions use fixed names (`data`, `evidence`, `backups`, `logs`). The main process resolves the real paths. |
| Navigation | In-app navigation is limited to the local server origin. `http(s)` and `mailto` links open in the default browser. `file:`, `javascript:` and other local targets are blocked, and pop-up windows are denied. |
| Network | The embedded server listens on `127.0.0.1` on a random port and rejects other `Host` headers. PostgreSQL listens on `127.0.0.1` with a generated password. |
| Content Security Policy | Strict CSP from the server: no inline scripts and no remote origins. Report previews render in a sandboxed iframe without scripts. |
| Permissions | Only clipboard read/write and fullscreen are granted, and only to the Explorix page. Screen recording goes through a source picker in the main process (`setDisplayMediaRequestHandler`). Every other permission request is denied. |
| Secrets | The session secret, database password and encryption key are generated per installation and stored with Windows DPAPI. |
| Exports | Reports and packages contain only relative evidence paths. They never include application-data paths, database files, settings or credentials (verified by the e2e tests). |

## Building from source

Requirements: Windows 10/11 x64, Node.js 22+ and npm 10+. Only the developer needs these, not the end user.

```bash
npm install
npm run desktop          # development: builds main/preload/server bundles and launches Electron
npm run dist:win         # installer + portable → apps/desktop/release/
```

`npm run dist:win` runs `node scripts/build.mjs --stage` and then `electron-builder --win`:

1. **Build.** esbuild bundles the main process and preloads (CommonJS) and the server (one ESM file). Vite builds the web UI.
2. **Stage.** Into `apps/desktop/build/resources/`:
   - the server bundle and migrations;
   - the web UI;
   - the PostgreSQL binaries (`bin`, `lib`, `share`);
   - `legal/LICENSE.txt` and `legal/THIRD_PARTY_NOTICES.txt` (copied from the repository root; Help > Third-Party Notices opens the latter);
   - the runtime dependency closure of the server's external packages: Prisma engine, sharp, pino, swagger-ui-express, strtok3, and their dependencies and required peers.
3. **Verify.** The staging step scans the server bundle for every runtime `import`/`require` and **fails the build** if a module is not staged. A packaged app cannot fall back to the repository's `node_modules`. It also **fails the build** if `THIRD_PARTY_NOTICES.md` no longer matches the installed dependencies; run `npm run notices` and commit the result.
4. **Package.** electron-builder writes `app.asar` and copies the staged resources. The `afterPack` hook (`scripts/after-pack.cjs`) copies the server's `node_modules`, which electron-builder always drops from `extraResources`. Then the NSIS installer and the portable exe are built.

`npm run dist:dir -w @explorix/desktop` builds only `release/win-unpacked/`, which is quicker for testing.

Packaging configuration is in the `build` field of `apps/desktop/package.json`:
- appId `com.explorix.desktop`;
- per-user NSIS with a choice of folder, shortcuts and run-after-finish, and `deleteAppDataOnUninstall: false`;
- portable target.

## Tests

| Command | What it covers |
|---|---|
| `npm test -w @explorix/desktop` | Unit tests (9): IPC argument validation and sender trust, URL classification, safe filenames, overwrite protection, atomic file and folder save, cancellation leaves nothing behind, corrupt-settings recovery, DPAPI secrets never written in plain text |
| `npm run test:e2e -w @explorix/desktop` | Playwright drives the **real Electron app** with an isolated data folder (`EXPLORIX_HOME`) and scripted native dialogs. See below for the scenarios. |
| `EXPLORIX_E2E_EXE=<path>\Explorix.exe npx playwright test -c e2e` (in `apps/desktop`) | The same e2e suite against a packaged or installed build |

The 6 e2e tests cover these scenarios:
1. Window security settings, no Node.js in the renderer, pop-ups blocked, and IPC rejection codes for bad arguments, bad folders, signed-out calls and file URLs.
2. First-run setup and loading the sample project.
3. Recording a genuine WebM in the app and attaching it. Duration and thumbnail are derived, and the checksum is unchanged. A fake MP4 is rejected.
4. Generating PDF, DOCX, HTML and Markdown. Each output is parsed: pdf.js text extraction, mammoth for DOCX, and every relative link in the MD and HTML is resolved.
5. Save As overwrite protection: *Cancel* keeps the existing report; *Keep both* creates "(2)".
6. A ZIP evidence package: README, manifest, all formats, the original video byte-identical, and no home paths, secrets or database files.
7. Backup, add a file, restore. The database and evidence return to the backup state.
8. Restart persistence: data is outside the install folder, the sign-in screen shows again, and the menu-to-renderer navigation bridge works.

Results for the 3.0.0 build (UI redesign; see [DESIGN.md](DESIGN.md)) on Windows 11:

| Run | Result |
|---|---|
| Desktop unit tests | 9 / 9 passed |
| Desktop e2e, development build | 6 / 6 passed |
| Desktop e2e, `release\win-unpacked\Explorix.exe` | 6 / 6 passed |
| Server tests (`npm test`) / web e2e (`npm run test:e2e`) | 74 / 74 and 21 / 21 passed |
| Installed app (silent install / uninstall) | Not repeated for 3.0.0. The packaging and installer configuration are unchanged from 2.0.0 (results below). |

Results for the 2.0.0 build on Windows 11:

| Run | Result |
|---|---|
| Desktop unit tests | 9 / 9 passed |
| Desktop e2e, development build | 6 / 6 passed |
| Desktop e2e, `release\win-unpacked\Explorix.exe` | 6 / 6 passed |
| Desktop e2e, app **installed** with `Explorix-Setup-2.0.0.exe /S` | 6 / 6 passed |
| Installer | Silent per-user install. Shortcuts and the *Apps & features* entry were created. A launch with default settings created `%APPDATA%\Explorix` and was ready in 7 s. Window close shut down cleanly with no PostgreSQL left running. Silent uninstall removed the program, shortcuts and registry entry; all 1,649 data files remained. |
| Portable exe | Launched with an isolated data folder, ready in 68 s (self-extraction), closed cleanly |
| Server tests (`npm test`) | 74 / 74 passed |
| Web e2e (`npm run test:e2e`) | 21 / 21 passed |

Two packaging defects were found only by testing the *installed* app. Both are fixed, and a build-time check now catches this class of problem:
- missing peer dependency `express`;
- `strtok3`, loaded through a hidden runtime import.

## Known limitations

- **Unsigned installer.** SmartScreen will warn on first run.
- **No automatic update channel.** Install a newer version over the old one; data is kept and upgraded with a safety backup.
- **Windows x64 only.** No macOS, Linux or ARM64 builds.
- **The portable build is slow to start** (about 1 minute) because it self-extracts on every launch. Prefer the installer.
- **No file associations.** Backups are ordinary `.zip` files and are opened from inside Explorix.
- **Video:** MOV files with HEVC or ProRes are stored and reported, but may not play or produce thumbnails. There is no ffmpeg: duration and frames are read by the built-in Chromium player.
- **Backups** contain password hashes and require everyone to sign in again after a restore. Integration secrets must be re-entered on another computer.
- **Remote synchronisation** is not implemented. Storage goes through one storage module (`apps/server/src/lib/storage.ts`) and evidence uses relative keys, so a sync or remote-storage provider can be added later without changing the data model.
- `npm audit` reports 4 high-severity advisories in Prisma's development tooling. They are not shipped to end users.
