// HTTP plumbing: JSON responses, error → status mapping, body parsing, input helpers, CORS.
import { AppError, validationError, type ErrorKind } from '../domain/errors';

const STATUS: Record<ErrorKind, number> = { validation: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, locked: 429 };

/** For transport-level problems that are not business errors (e.g. 405). */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) return json({ error: { code: err.code, message: err.message, details: err.details } }, STATUS[err.kind]);
  if (err instanceof HttpError) return json({ error: { code: err.code, message: err.message } }, err.status);
  console.error(err);
  return json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw validationError('Expected application/json body');
  try {
    return (await req.json()) as T;
  } catch {
    throw validationError('Body is not valid JSON');
  }
}

// ---------- input helpers (shape checks; business rules live in the use cases) ----------
export function asString(v: unknown, field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null) {
    if (opts.optional) return '';
    throw validationError(`${field} is required`);
  }
  if (typeof v !== 'string') throw validationError(`${field} must be a string`);
  const s = v.trim();
  if (opts.min !== undefined && s.length < opts.min) throw validationError(`${field} must be at least ${opts.min} characters`);
  if (opts.max !== undefined && s.length > opts.max) throw validationError(`${field} must be at most ${opts.max} characters`);
  return s;
}

export const optString = (v: unknown, field: string, opts: { min?: number; max?: number } = {}) =>
  v === undefined ? undefined : asString(v, field, opts);

export function asInt(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw validationError(`${field} must be an integer`);
  if (v < min || v > max) throw validationError(`${field} must be between ${min} and ${max}`);
  return v;
}

export function asEnum<T extends string>(v: unknown, field: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !values.includes(v as T)) throw validationError(`${field} must be one of: ${values.join(', ')}`);
  return v as T;
}

export const optEnum = <T extends string>(v: unknown, field: string, values: readonly T[]) => (v === undefined ? undefined : asEnum(v, field, values));

export function asIntArray(v: unknown, field: string, min: number, max: number, opts: { minLength?: number } = {}): number[] {
  if (!Array.isArray(v)) throw validationError(`${field} must be an array`);
  const out = [...new Set(v.map((x, i) => asInt(x, `${field}[${i}]`, min, max)))].sort((a, b) => a - b);
  if (opts.minLength !== undefined && out.length < opts.minLength) throw validationError(`${field} needs at least ${opts.minLength} item(s)`);
  return out;
}

export function asId(v: string | undefined, what = 'Resource'): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new AppError('not_found', 'not_found', `${what} not found`);
  return n;
}

// ---------- CORS ----------
export function corsHeaders(req: Request, allowed: string | undefined): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return {};
  const list = (allowed ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  // Cloudflare Pages preview deployments: https://<hash>.balance-our-day.pages.dev
  const ok = list.includes(origin) || list.some((o) => {
    try {
      const a = new URL(o);
      const b = new URL(origin);
      return a.protocol === 'https:' && b.protocol === 'https:' && b.hostname.endsWith('.' + a.hostname);
    } catch {
      return false;
    }
  });
  if (!ok) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}
