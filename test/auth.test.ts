// Signing in to edit (src/editor/auth.ts): sessions outlive a restart, and end with a new password or a sign-out.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { type SessionStore, createAuth } from '../src/editor/auth.js';

const request = (cookie = '') => ({ headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } }) as unknown as IncomingMessage;
function response() {
  let cookie = '';
  return { res: { setHeader: (_k: string, v: string) => (cookie = v) } as unknown as ServerResponse, cookie: () => cookie.split(';')[0] };
}
const memory = (): SessionStore & { text: string | null } => ({ text: null, read() { return this.text; }, write(t) { this.text = t; } });

describe('signing in', () => {
  it('keeps only hashes of the sessions, which a restart reads back', async () => {
    const keep = memory();
    const before = createAuth('open sesame', { keep });
    const r = response();
    expect(await before.login(request(), r.res, 'open sesame')).toBe('ok');
    const cookie = r.cookie();
    expect(before.admin(request(cookie))).toBe(true);
    expect(keep.text).not.toContain(cookie.split('=')[1]); // never the token itself, nor the password
    expect(keep.text).not.toContain('open sesame');

    const after = createAuth('open sesame', { keep }); // the editor restarted
    expect(after.admin(request(cookie))).toBe(true);
    expect(after.admin(request('tykerf_session=made-up'))).toBe(false);
    // a sign-out ends it for good, restarts included
    after.logout(request(cookie), response().res);
    expect(createAuth('open sesame', { keep }).admin(request(cookie))).toBe(false);
  });

  it('ends every session when the password changes', async () => {
    const keep = memory();
    const r = response();
    await createAuth('open sesame', { keep }).login(request(), r.res, 'open sesame');
    expect(createAuth('another one', { keep }).admin(request(r.cookie()))).toBe(false);
    expect(createAuth(null, { keep }).admin(request())).toBe(true); // no password: everyone edits, as before
  });
});
