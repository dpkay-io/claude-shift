export const SHELL_META = /[;&|`${}[\]!#~<>*?\n\r]/;
// eslint-disable-next-line no-control-regex
export const ANSI_RE = /[\x1B\x9B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
