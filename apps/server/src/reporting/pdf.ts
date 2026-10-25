import { pathToFileURL } from 'node:url';
import { config } from '../config.js';

export interface PdfRenderRequest {
  /** Absolute path of a standalone HTML file; relative image paths resolve against its folder. */
  htmlPath: string;
  outPath: string;
  title: string;
  footerLabel: string;
  landscape: boolean;
  signal?: AbortSignal;
}

/**
 * Converts the print-optimised HTML report to PDF. The desktop shell registers an
 * Electron (sandboxed, offline BrowserWindow + printToPDF) implementation; the
 * server and the test suite use Playwright's Chromium when PDF_RENDERER=playwright.
 */
export type PdfRenderer = (req: PdfRenderRequest) => Promise<void>;

let renderer: PdfRenderer | null = null;

export function setPdfRenderer(fn: PdfRenderer | null) {
  renderer = fn;
}

export function getPdfRenderer(): PdfRenderer | null {
  if (renderer) return renderer;
  if (config.PDF_RENDERER === 'playwright') return playwrightRenderer;
  return null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Header/footer templates shared by Chromium-based renderers. */
export function pageTemplates(title: string, footerLabel: string) {
  const style = 'font-family: Segoe UI, Arial, sans-serif; font-size: 8px; color: #6b7280; width: 100%; padding: 0 15mm;';
  return {
    header: `<div style="${style} display:flex; justify-content:space-between;"><span>${esc(title)}</span><span>${esc(footerLabel)}</span></div>`,
    footer: `<div style="${style} text-align:center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
  };
}

const playwrightRenderer: PdfRenderer = async (req) => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ headless: true });
  const abort = () => void browser.close().catch(() => {});
  req.signal?.addEventListener('abort', abort, { once: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    const page = await context.newPage();
    // Only the report's own local files may load.
    await page.route('**/*', (route) => (route.request().url().startsWith('file:') || route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    await page.goto(pathToFileURL(req.htmlPath).href, { waitUntil: 'load' });
    const t = pageTemplates(req.title, req.footerLabel);
    await page.pdf({
      path: req.outPath,
      format: 'A4',
      landscape: req.landscape,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: t.header,
      footerTemplate: t.footer,
      margin: { top: '20mm', bottom: '18mm', left: '15mm', right: '15mm' },
      preferCSSPageSize: true,
      outline: true,
      tagged: true,
    });
  } finally {
    req.signal?.removeEventListener('abort', abort);
    await browser.close().catch(() => {});
  }
};
