import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createDesktopServer } from '../src/server.mjs';
import { readConfig } from '../src/config.mjs';

const token = 'test-only-managed-token-not-a-secret-1234';
const authorization = `Bearer ${token}`;
async function start(t, port = null) {
  const app = createDesktopServer({ token, config: { host: '127.0.0.1', port } });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, url, wsUrl: url.replace('http:', 'ws:') + '/ws' };
}
function expectRejected(url, headers, status) {
  return new Promise((done, fail) => {
    const ws = new WebSocket(url, { headers });
    ws.once('unexpected-response', (_req, res) => {
      try { assert.equal(res.statusCode, status); res.resume(); ws.terminate(); done(); }
      catch (error) { fail(error); }
    });
    ws.on('error', () => {});
    ws.once('open', () => { ws.terminate(); fail(new Error('Unexpected connection')); });
  });
}
async function echoServer(t) {
  const peers = new Set();
  const server = net.createServer(peer => {
    peers.add(peer);
    peer.on('data', data => peer.write(data));
    peer.on('error', () => {});
    peer.once('close', () => peers.delete(peer));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const peer of peers) peer.destroy();
    await new Promise(done => server.close(done));
  });
  return server.address().port;
}
test('configuration is opt-in and cannot choose a remote destination', () => {
  assert.deepEqual(readConfig({}), { host: '127.0.0.1', port: null });
  assert.equal(readConfig({ REMOTE_DESKTOP_VNC_PORT: '5900' }).port, 5900);
  for (const value of ['0', '-1', '1.5', '65536', '5900x', 'https://example.org']) {
    assert.throws(() => readConfig({ REMOTE_DESKTOP_VNC_PORT: value }));
  }
  assert.throws(() => createDesktopServer({ token: '', config: { port: 5900 } }));
  assert.throws(() => createDesktopServer({ token, config: { host: 'example.org', port: 5900 } }));
});
test('all HTTP assets and status require the host bearer', async t => {
  const app = await start(t);
  for (const path of ['/', '/health', '/api/status', '/vendor/novnc/core/rfb.js', '/ui']) {
    assert.equal((await fetch(app.url + path)).status, 401);
    assert.equal((await fetch(app.url + path, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  }
  const res = await fetch(app.url + '/health', { headers: { authorization } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ready, false);
  assert.equal((await fetch(app.url + '/', { headers: { authorization, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(app.url + '/', { method: 'POST', headers: { authorization } })).status, 405);
});
test('built assets include original MPL source and notices, but no project secrets', async t => {
  const app = await start(t);
  for (const path of ['/', '/ui', '/app.js', '/credits.html', '/vendor/novnc/LICENSE.txt', '/vendor/novnc/docs/LICENSE.MPL-2.0', '/vendor/novnc/vendor/pako/LICENSE', '/licenses/ws.txt']) {
    const res = await fetch(app.url + path, { headers: { authorization } });
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  const source = await fetch(app.url + '/vendor/novnc/core/rfb.js', { headers: { authorization } });
  assert.equal(await source.text(), await readFile(new URL('../node_modules/@novnc/novnc/core/rfb.js', import.meta.url), 'utf8'));
  for (const path of ['/.env', '/package-lock.json', '/src/server.mjs', '/%2e%2e%2f.env', '/%5c..%5c.env']) {
    const status = await new Promise((done, fail) => {
      http.get(app.url + path, { headers: { authorization } }, res => { res.resume(); done(res.statusCode); }).on('error', fail);
    });
    assert.equal(status, 404, path);
  }
});
test('WebSocket requires auth, exact origin, fixed route, and a configured backend', async t => {
  const app = await start(t);
  await expectRejected(app.wsUrl, { origin: app.url }, 401);
  await expectRejected(app.wsUrl, { authorization }, 403);
  await expectRejected(app.wsUrl, { authorization, origin: 'https://evil.example' }, 403);
  await expectRejected(app.wsUrl, { authorization, origin: app.url, 'sec-fetch-site': 'cross-site' }, 403);
  await expectRejected(app.wsUrl + '?host=evil', { authorization, origin: app.url }, 404);
  await expectRejected(app.wsUrl, { authorization, origin: app.url }, 503);
});
test('binary stream is preserved; concurrent control is rejected and slot is released', async t => {
  const port = await echoServer(t);
  const app = await start(t, port);
  const headers = { authorization, origin: app.url };
  const ws = new WebSocket(app.wsUrl, { headers });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  const reply = once(ws, 'message');
  ws.send(Buffer.from([0, 1, 127, 255]));
  assert.deepEqual((await reply)[0], Buffer.from([0, 1, 127, 255]));
  await expectRejected(app.wsUrl, headers, 409);
  ws.close();
  await once(ws, 'close');
  const next = new WebSocket(app.wsUrl, { headers });
  t.after(() => next.terminate());
  await once(next, 'open');
  const closed = once(next, 'close');
  next.send('text is not RFB');
  assert.equal((await closed)[0], 1003);
});
test('a failed VNC connection closes the viewer without leaking backend details', async t => {
  const unused = net.createServer();
  unused.listen(0, '127.0.0.1');
  await once(unused, 'listening');
  const port = unused.address().port;
  await new Promise(done => unused.close(done));
  const app = await start(t, port);
  const ws = new WebSocket(app.wsUrl, { headers: { authorization, origin: app.url } });
  t.after(() => ws.terminate());
  const closed = once(ws, 'close');
  const [code, reason] = await closed;
  assert.equal(code, 1011);
  assert.equal(reason.toString(), 'VNC server unavailable');
});
