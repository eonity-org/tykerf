// Who may edit when TYKERF serves a site to visitors. With TYKERF_ADMIN_PASSWORD set, visitors get the
// pages as they are (no editor, no /_tykerf/ API) and the admin signs in at /_tykerf/login: a random
// session token in an HttpOnly cookie, kept in memory (a restart signs everyone out). Without it, TYKERF
// is the local editor it always was, and everyone who reaches it edits.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const COOKIE = 'tykerf_session';
const SESSION_MS = 7 * 24 * 3600_000;
/** After this many wrong passwords from one address, it waits LOCK_MS before trying again. */
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60_000;

export interface Auth {
  /** Whether sign-in is on (a password is set). */
  readonly on: boolean;
  /** Whether this request comes from the signed-in admin (always true when sign-in is off). */
  admin(req: IncomingMessage): boolean;
  /** POST /_tykerf/login {password}: sets the session cookie, or says why not. */
  login(req: IncomingMessage, res: ServerResponse, password: string): Promise<'ok' | 'wrong' | 'locked'>;
  /** POST /_tykerf/logout: ends the session. */
  logout(req: IncomingMessage, res: ServerResponse): void;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

function cookieOf(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

/** `secure`: the cookie only travels over HTTPS (the public address is https, or a proxy says so). */
export function createAuth(password: string | null | undefined, opts: { secure?: boolean } = {}): Auth {
  const sessions = new Map<string, number>(); // token → expiry
  const fails = new Map<string, { n: number; until: number }>(); // address → wrong passwords
  const wanted = password ? digest(password) : null;
  const valid = (req: IncomingMessage) => {
    const token = cookieOf(req);
    const until = token ? sessions.get(token) : undefined;
    if (!token || !until) return false;
    if (until < Date.now()) return sessions.delete(token), false;
    return true;
  };
  const setCookie = (req: IncomingMessage, res: ServerResponse, value: string, maxAge: number) => {
    const secure = opts.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('set-cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  };
  return {
    on: !!wanted,
    admin: (req) => !wanted || valid(req),
    async login(req, res, given) {
      if (!wanted) return 'ok';
      const who = req.socket.remoteAddress ?? '?';
      const f = fails.get(who);
      if (f && f.n >= MAX_FAILS && f.until > Date.now()) return 'locked';
      // compare digests, so the time taken says nothing about the password
      if (!timingSafeEqual(digest(given), wanted)) {
        const n = f && f.until > Date.now() ? f.n + 1 : 1;
        fails.set(who, { n, until: Date.now() + LOCK_MS });
        await new Promise((ok) => setTimeout(ok, 800)); // slows guessing
        return 'wrong';
      }
      fails.delete(who);
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, Date.now() + SESSION_MS);
      setCookie(req, res, token, SESSION_MS / 1000);
      return 'ok';
    },
    logout(req, res) {
      const token = cookieOf(req);
      if (token) sessions.delete(token);
      setCookie(req, res, '', 0);
    },
  };
}

/** The sign-in page: a password and a button; it goes on to `next` (an address on this site) once signed in. */
export function loginPage(next: string): string {
  const to = /^\/(?!\/)[^\s"<>]*$/.test(next) ? next : '/_tykerf/site/';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TYKERF · sign in</title>
<link rel="icon" href="/_tykerf/favicon.svg" type="image/svg+xml">
<style>
  @font-face { font-family: tykerf-plex-sans; src: url('/_tykerf/fonts/IBMPlexSans-Regular-Latin1.woff2') format('woff2'); font-weight: 400; }
  @font-face { font-family: tykerf-plex-sans; src: url('/_tykerf/fonts/IBMPlexSans-SemiBold-Latin1.woff2') format('woff2'); font-weight: 600; }
  html, body { margin: 0; min-height: 100%; }
  body { background: #F2F7F9; font-family: tykerf-plex-sans, system-ui, sans-serif; color: #10303F; line-height: 1.5; }
  header { display: flex; align-items: center; gap: 12px; padding: 12px 20px; background: #0A5475; color: #fff; }
  header svg { width: 22px; height: 22px; fill: #fff; }
  header svg .focus { fill: #EA9A27; }
  main { max-width: 380px; margin: 64px auto; padding: 0 20px; }
  form { display: grid; gap: 12px; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 6px 24px rgb(0 0 0 / .08); }
  h1 { font-size: 20px; margin: 0; }
  label { display: grid; gap: 4px; font-weight: 600; font-size: 14px; }
  input { font: inherit; padding: 8px 10px; border: 1px solid #9DB8C4; border-radius: 8px; }
  button { font: inherit; font-weight: 600; padding: 9px 14px; border: 0; border-radius: 8px; background: #0A5475; color: #fff; cursor: pointer; }
  .error { margin: 0; color: #B42318; font-size: 14px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0B1D26; color: #EAF3F7; }
    form { background: #12303D; box-shadow: none; }
    input { background: #0B1D26; border-color: #2B5566; color: #EAF3F7; }
    .error { color: #FF8A80; }
  }
</style>
</head>
<body>
<header><svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="20" rx="6"/><rect y="27" width="28.5" height="37" rx="6"/><rect class="focus" x="35.5" y="27" width="28.5" height="12" rx="3"/><rect x="35.5" y="45" width="11.25" height="19" rx="3"/><rect x="52.75" y="45" width="11.25" height="19" rx="3"/></svg><b>tykerf</b></header>
<main>
  <form>
    <h1>Sign in to edit this site</h1>
    <label>Password <input type="password" name="password" autocomplete="current-password" required autofocus></label>
    <p class="error" role="alert" hidden></p>
    <button type="submit">Sign in</button>
  </form>
</main>
<script>
  const form = document.querySelector('form'), error = document.querySelector('.error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch('/_tykerf/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: form.password.value }) });
    if (r.ok) return location.replace(${JSON.stringify(to)});
    error.hidden = false;
    error.textContent = r.status === 429 ? 'Too many tries. Wait a few minutes, then try again.' : 'That password is not right.';
    form.password.select();
  };
</script>
</body>
</html>
`;
}
