// Business errors. They know nothing about HTTP; src/http/errors.ts maps them to status codes.

export type ErrorKind = 'validation' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'locked';

export class AppError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const validationError = (message: string, details?: unknown, code = 'bad_request') => new AppError('validation', code, message, details);
export const unauthorizedError = (message = 'Login required', code = 'unauthorized') => new AppError('unauthorized', code, message);
export const forbiddenError = (message = 'Not allowed') => new AppError('forbidden', 'forbidden', message);
export const notFoundError = (message = 'Not found') => new AppError('not_found', 'not_found', message);
export const conflictError = (code: string, message: string, details?: unknown) => new AppError('conflict', code, message, details);
export const lockedError = (message: string) => new AppError('locked', 'locked', message);
