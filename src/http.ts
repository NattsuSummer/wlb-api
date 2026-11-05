export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Login required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  console.error(err);
  return json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw badRequest('Expected application/json body');
  try {
    return (await req.json()) as T;
  } catch {
    throw badRequest('Body is not valid JSON');
  }
}

// ---------- tiny input helpers ----------
export function asString(v: unknown, field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null) {
    if (opts.optional) return '';
    throw badRequest(`${field} is required`);
  }
  if (typeof v !== 'string') throw badRequest(`${field} must be a string`);
  const s = v.trim();
  if (opts.min !== undefined && s.length < opts.min) throw badRequest(`${field} must be at least ${opts.min} characters`);
  if (opts.max !== undefined && s.length > opts.max) throw badRequest(`${field} must be at most ${opts.max} characters`);
  return s;
}

export function asInt(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw badRequest(`${field} must be an integer`);
  if (v < min || v > max) throw badRequest(`${field} must be between ${min} and ${max}`);
  return v;
}

export function asEnum<T extends string>(v: unknown, field: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !values.includes(v as T)) throw badRequest(`${field} must be one of: ${values.join(', ')}`);
  return v as T;
}

export function asIntArray(v: unknown, field: string, min: number, max: number, opts: { minLength?: number } = {}): number[] {
  if (!Array.isArray(v)) throw badRequest(`${field} must be an array`);
  const out = [...new Set(v.map((x, i) => asInt(x, `${field}[${i}]`, min, max)))].sort((a, b) => a - b);
  if (opts.minLength !== undefined && out.length < opts.minLength) throw badRequest(`${field} needs at least ${opts.minLength} item(s)`);
  return out;
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
