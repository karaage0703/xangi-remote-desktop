import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DESECBCipher } from '../node_modules/@novnc/novnc/core/crypto/des.js';
import { createAuthBridge, challengeResponse } from '../src/vnc-auth.mjs';
import { createBrowserAuth, loadSavedAuth } from '../src/browser-auth.mjs';
import { createDesktopServer } from '../src/server.mjs';
import { WebSocket } from 'ws';

const password = 'test1234';
const key = 'ab'.repeat(32);
test('VNC challenge response agrees with the independent noVNC cipher', () => {
  const challenge = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
  const cipher = DESECBCipher.importKey(Uint8Array.from(password, c => c.charCodeAt(0)));
  assert.deepEqual(challengeResponse(password, challenge), Buffer.from(cipher.encrypt({}, challenge)));
});
for (const version of [3, 7, 8]) {
  test(`RFB 3.${version}: fragmented auth stays server-side, coalesced ClientInit is preserved`, () => {
    const up = [], down = []; let ready = false;
    const bridge = createAuthBridge({ password, toServer: b => up.push(b), toViewer: b => down.push(b), onReady: () => { ready = true; } });
    const feed = data => { for (const byte of data) bridge.fromServer(Buffer.from([byte])); };
    feed(Buffer.from(`RFB 003.00${version}\n`));
    bridge.fromViewer(Buffer.from('RFB 003.008\n'));
    bridge.fromViewer(Buffer.from([1, 1])); // security selection + shared ClientInit
    feed(version === 3 ? Buffer.from([0, 0, 0, 2]) : Buffer.from([2, 1, 2]));
    const challenge = Buffer.from('0123456789abcdef'); feed(challenge);
    assert.equal(ready, false);
    assert.deepEqual(up.at(-1), challengeResponse(password, challenge));
    feed(Buffer.alloc(4));
    assert.equal(ready, true); assert.deepEqual(up.at(-1), Buffer.from([1]));
    assert.deepEqual(Buffer.concat(down), Buffer.concat([Buffer.from('RFB 003.008\n'), Buffer.from([1, 1, 0, 0, 0, 0])]));
    bridge.fromServer(Buffer.from([0, 255, 9])); assert.deepEqual(down.at(-1), Buffer.from([0, 255, 9]));
    bridge.fromViewer(Buffer.from([4, 1, 0])); assert.deepEqual(up.at(-1), Buffer.from([4, 1, 0]));
  });
}
test('failed, unsupported, and oversized handshakes do not open the stream', () => {
  const make = () => createAuthBridge({ password, toServer() {}, toViewer() {}, onReady() { assert.fail('must not authenticate'); } });
  let b = make(); assert.throws(() => b.fromServer(Buffer.from('RFB 003.006\n')));
  b = make(); b.fromServer(Buffer.from('RFB 003.008\n')); assert.throws(() => b.fromServer(Buffer.from([1, 1])));
  b = make(); b.fromServer(Buffer.from('RFB 003.008\n')); b.fromServer(Buffer.concat([Buffer.from([1, 2]), Buffer.alloc(16)])); assert.throws(() => b.fromServer(Buffer.from([0, 0, 0, 1])));
  assert.throws(() => make().fromViewer(Buffer.alloc(65537)));
});
test('browser registration expires, rejects tampering and old keys, and throttles failures', () => {
  let time = Date.now(); const auth = createBrowserAuth(key, true, () => time);
  const result = auth.register(key); assert.equal(result.status, 200);
  assert.match(result.cookie, /HttpOnly; SameSite=Strict/); assert.match(result.cookie, /; Secure$/);
  const req = { headers: { cookie: result.cookie.split(';')[0] } };
  assert.equal(auth.valid(req), true);
  assert.equal(auth.valid({ headers: { cookie: req.headers.cookie + 'a' } }), false);
  assert.equal(createBrowserAuth('cd'.repeat(32)).valid(req), false);
  time += 30 * 86400_000; assert.equal(auth.valid(req), false);
  for (let i = 0; i < 5; i++) assert.equal(auth.register('wrong').status, 403);
  assert.equal(auth.register(key).status, 429); time += 60_000; assert.equal(auth.register(key).status, 200);
});
test('credential loader fails closed, enforces permissions, persists registration key', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-auth-')); t.after(() => rm(dir, { recursive: true }));
  const file = join(dir, 'password'); const browser = join(dir, 'browser-key');
  await writeFile(file, password, { mode: 0o600 });
  const env = { REMOTE_DESKTOP_VNC_PASSWORD_FILE: file, REMOTE_DESKTOP_BROWSER_KEY_FILE: browser };
  const a = await loadSavedAuth(env), b = await loadSavedAuth(env);
  assert.equal(a.password, password); assert.equal(b.password, password);
  await chmod(file, 0o644); await assert.rejects(loadSavedAuth(env));
  await chmod(file, 0o600); await writeFile(file, 'too-long-password'); await assert.rejects(loadSavedAuth(env));
  await assert.rejects(loadSavedAuth({ ...env, REMOTE_DESKTOP_VNC_PASSWORD_FILE: '/nonexistent/password' }));
  assert.equal(await loadSavedAuth({}), null);
});
test('automatic mode rejects unregistered WebSockets and keeps secrets out of status', async t => {
  const token = 'host-token-for-test-only-123456789012';
  const app = createDesktopServer({ token, config: { host: '127.0.0.1', port: 59999 }, savedAuth: { password, auth: createBrowserAuth(key, false) } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`, headers = { authorization: `Bearer ${token}`, origin: base };
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers }); ws.on('error', () => {});
  const [, rejected] = await once(ws, 'unexpected-response'); assert.equal(rejected.statusCode, 403); rejected.resume(); ws.terminate();
  const register = code => fetch(base + '/api/register', { method: 'POST', headers, body: JSON.stringify({ code }) });
  assert.equal((await register('wrong')).status, 403);
  assert.equal((await fetch(base + '/api/register', { method: 'POST', headers: { authorization: headers.authorization }, body: JSON.stringify({ code: key }) })).status, 403);
  const result = await register(key); assert.equal(result.status, 200);
  const cookie = result.headers.get('set-cookie').split(';')[0];
  const response = await fetch(base + '/api/status', { headers: { ...headers, cookie } }); const text = await response.text();
  assert.equal(JSON.parse(text).registered, true); assert.ok(!text.includes(password)); assert.ok(!text.includes(key));
  const forget = await fetch(base + '/api/forget', { method: 'POST', headers: { ...headers, cookie } });
  assert.equal(forget.status, 204); assert.match(forget.headers.get('set-cookie'), /Max-Age=0/);
});

test('optional permanent registrations remain valid, renew only their cookies, and require a signed opt-in', () => {
  let time = Date.now();
  const auth = createBrowserAuth(key, true, () => time);
  const ordinary = auth.register(key).cookie.split(';')[0];
  const permanent = auth.register(key, true).cookie.split(';')[0];
  const request = cookie => ({ headers: { cookie } });
  assert.match(permanent, /^desktop_session=never\./);
  assert.equal(auth.renewCookie(request(ordinary)), null);
  assert.match(auth.renewCookie(request(permanent)), /Max-Age=34560000; Secure/);
  time += 5 * 365 * 86400_000;
  assert.equal(auth.valid(request(ordinary)), false);
  assert.equal(auth.valid(request(permanent)), true);
  assert.equal(auth.valid(request(ordinary.replace(/=\d+\./, '=never.'))), false);
  assert.equal(createBrowserAuth('ef'.repeat(32), true, () => time).valid(request(permanent)), false);
  assert.equal(auth.renewCookie(request(permanent + 'x')), null);
  assert.equal(auth.register(key, 'true').status, 400);
  assert.match(auth.clearCookie(), /Max-Age=0/);
});
