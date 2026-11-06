/** Password rules shared with the frontend. Returns the codes of the rules that fail. */
export function passwordProblems(pw: string, opts: { forbid?: string[] } = {}): string[] {
  const out: string[] = [];
  if (pw.length < 8) out.push('min_length_8');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) out.push('letters_and_digits');
  if (opts.forbid?.includes(pw)) out.push('not_default');
  return out;
}

export const MAX_FAILED_LOGINS = 10;
export const LOCK_MINUTES = 15;
export const SESSION_DAYS_SHORT = 1;
export const SESSION_DAYS_REMEMBER = 30;
