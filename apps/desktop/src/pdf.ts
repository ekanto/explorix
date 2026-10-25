import { BrowserWindow, session } from 'electron';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

interface PdfRenderRequest {
  htmlPath: string;
  outPath: string;
  title: string;
  footerLabel: string;
  landscape: boolean;
  signal?: AbortSignal;
}

const MM_PER_INCH = 25.4;

/**
 * Renders the report's print HTML to PDF with Chromium's print engine (real, selectable text,
 * tagged PDF with a document outline). The window is hidden, sandboxed, has JavaScript
 * disabled and lives in an isolated in-memory session that can only load local files.
 */
export function createPdfRenderer(pageTemplates: (title: string, footer: string) => { header: string; footer: string }) {
  const ses = session.fromPartition('explorix-pdf');
  ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !/^(file|data):/i.test(details.url) }));
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  return async (req: PdfRenderRequest) => {
    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 1400,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, spellcheck: false },
    });
    const abort = () => {
      if (!win.isDestroyed()) win.destroy();
    };
    req.signal?.addEventListener('abort', abort, { once: true });
    try {
      await win.loadURL(pathToFileURL(req.htmlPath).href);
      req.signal?.throwIfAborted();
      const t = pageTemplates(req.title, req.footerLabel);
      const pdf = await win.webContents.printToPDF({
        pageSize: 'A4',
        landscape: req.landscape,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: t.header,
        footerTemplate: t.footer,
        margins: { top: 20 / MM_PER_INCH, bottom: 18 / MM_PER_INCH, left: 15 / MM_PER_INCH, right: 15 / MM_PER_INCH },
        preferCSSPageSize: true,
        generateDocumentOutline: true,
        generateTaggedPDF: true,
      });
      req.signal?.throwIfAborted();
      await fs.writeFile(req.outPath, pdf);
    } finally {
      req.signal?.removeEventListener('abort', abort);
      if (!win.isDestroyed()) win.destroy();
    }
  };
}
