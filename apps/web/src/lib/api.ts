/**
 * Thin fetch wrapper for the Explorix REST API.
 * - Always sends cookies (server-managed session) and the CSRF header the server
 *   requires for cookie-authenticated mutations.
 * - Normalises error bodies `{ error: { code, message, details } }` into ApiError.
 */
export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Field-level validation messages, keyed by dotted path. */
  get fieldErrors(): Record<string, string> {
    const d = this.details as { fields?: { path: string; message: string }[] } | undefined;
    return Object.fromEntries((d?.fields ?? []).map((f) => [f.path, f.message]));
  }
}

type Query = Record<string, string | number | boolean | null | undefined | (string | number)[]>;

export function qs(params?: Query): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'explorix', Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (typeof body === 'string') {
    headers['Content-Type'] = 'text/plain';
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${url}`, { method, headers, body: payload, credentials: 'same-origin', ...init });
  if (res.status === 401 && !url.startsWith('/auth/')) onUnauthorized?.();
  const ct = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    let code = 'http_error';
    let message = `Request failed (${res.status})`;
    let details: unknown;
    if (ct.includes('application/json')) {
      const j = await res.json().catch(() => null);
      if (j?.error) ({ code, message, details } = j.error);
    }
    throw new ApiError(res.status, code, message, details);
  }
  if (res.status === 204) return undefined as T;
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T = any>(url: string, params?: Query) => request<T>('GET', url + qs(params)),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T = any>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  /** Upload raw text (CSV, JUnit XML) with a specific content type. */
  postText: <T = any>(url: string, text: string, contentType: string) =>
    request<T>('POST', url, undefined, { body: text, headers: { 'X-Requested-With': 'explorix', 'Content-Type': contentType } }),
};

/** Project-scoped URL helper: p(pid, '/charters') -> /projects/:pid/charters */
export const p = (projectId: string, path = '') => `/projects/${projectId}${path}`;

/** Trigger a browser download of an authenticated API resource (exports). */
export async function download(url: string, fallbackName: string) {
  const res = await fetch(`/api${url}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'explorix' } });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new ApiError(res.status, j?.error?.code ?? 'http_error', j?.error?.message ?? 'Download failed');
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const fields = Object.entries(err.fieldErrors);
    if (fields.length) return `${err.message}: ${fields.map(([k, v]) => `${k} — ${v}`).join('; ')}`;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
