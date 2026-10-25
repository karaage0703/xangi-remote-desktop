import http from 'node:http';
import { createAuthBridge } from './vnc-auth.mjs';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const defaultRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const MAX_BUFFER = 8 * 1024 * 1024;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

export function createDesktopServer({ token, config, staticRoot = defaultRoot, savedAuth = null }) {
  if (!token || token.length < 32) throw new Error('A managed extension token of at least 32 characters is required');
  if (config.host !== '127.0.0.1' || (config.port !== null && (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535))) {
    throw new Error('Only a fixed IPv4 loopback VNC destination is allowed');
  }
  const expected = Buffer.from(`Bearer ${token}`);
  const clients = new Set();
  let stopping = false;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  const root = resolve(staticRoot);
  const authorized = req => {
    const value = Buffer.from(req.headers.authorization || '');
    return value.length === expected.length && timingSafeEqual(value, expected);
  };
  const sameOrigin = req => {
    const origin = req.headers.origin;
    return typeof origin === 'string' && origin === `http://127.0.0.1:${server.address()?.port}`;
  };
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
  };
  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end('Internal error');
    });
  });
  async function handle(req, res) {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    if (!authorized(req)) { res.writeHead(401).end('Unauthorized'); return; }
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && !sameOrigin(req))) {
      res.writeHead(403).end('Forbidden'); return;
    }
    if (['/api/register', '/api/forget'].includes(new URL(req.url, 'http://localhost').pathname)) {
      if (req.method !== 'POST' || !sameOrigin(req)) { res.writeHead(403).end('Forbidden'); return; }
      if (!savedAuth) { res.writeHead(404).end(); return; }
      if (req.url === '/api/forget') {
        res.setHeader('Set-Cookie', savedAuth.auth.clearCookie()); res.writeHead(204).end(); return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
        if (body.length > 1024) { res.writeHead(413).end(); return; }
      }
      let code, permanent;
      try { ({ code, permanent } = JSON.parse(body)); } catch { res.writeHead(400).end(); return; }
      const result = savedAuth.auth.register(code, permanent);
      if (result.cookie) res.setHeader('Set-Cookie', result.cookie);
      res.writeHead(result.status).end(); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health' || url.pathname === '/api/status') {
      const renewal = url.pathname === '/api/status' && savedAuth?.auth.renewCookie(req);
      if (renewal) res.setHeader('Set-Cookie', renewal);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, ready: config.port !== null, configured: config.port !== null, connected: clients.size > 0, platform: process.platform, version: '0.1.0', autoAuth: !!savedAuth, registered: savedAuth ? savedAuth.auth.valid(req) : false }));
      return;
    }
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
    if (path === '/ui') path = '/launcher.html';
    if (path === '/') path = '/index.html';
    // Only built assets, including their original source and license texts, are served.
    const filename = resolve(root, `.${path}`);
    if (!filename.startsWith(`${root}${sep}`) || path.includes('\\') || path.includes('\0')) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(filename);
      res.setHeader('Content-Type', mime[extname(filename)] || 'text/plain; charset=utf-8');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) { res.writeHead(404).end('Not found'); return; }
      throw error;
    }
  }
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const reject = status => socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    if (!authorized(req)) { reject(401); return; }
    if (!sameOrigin(req) || req.headers['sec-fetch-site'] === 'cross-site') { reject(403); return; }
    if (req.url !== '/ws') { reject(404); return; }
    if (stopping || config.port === null) { reject(503); return; }
    if (savedAuth && !savedAuth.auth.valid(req)) { reject(403); return; }
    if (clients.size) { reject(409); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      clients.add(ws);
      const peer = net.createConnection({ host: config.host, port: config.port });
      const timer = setTimeout(() => finish(1011, 'VNC connection timed out'), savedAuth ? 10000 : 5000);
      let finished = false;
      function finish(code = 1000, reason = 'Disconnected') {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearInterval(heartbeat);
        peer.destroy();
        // Keep the slot reserved until the WebSocket has actually closed.
        if (ws.readyState === WebSocket.OPEN) ws.close(code, reason);
      }
      let alive = true;
      const heartbeat = setInterval(() => {
        if (!alive) { ws.terminate(); return; }
        alive = false;
        ws.ping();
      }, 30_000);
      heartbeat.unref();
      ws.on('pong', () => { alive = true; });
      peer.setNoDelay(true);
      peer.once('connect', () => { if (!savedAuth) clearTimeout(timer); });
      function toViewer(data) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount + data.length > MAX_BUFFER) { finish(1009, 'Viewer is too slow'); return; }
        peer.pause();
        ws.send(data, { binary: true }, error => {
          if (error) finish(1011, 'Stream failed');
          else if (!finished) peer.resume();
        });
      }
      function toServer(data) {
        if (peer.writableLength + data.length > MAX_BUFFER) { finish(1009, 'Input buffer exceeded'); return; }
        if (!finished) peer.write(data);
      }
      const bridge = savedAuth ? createAuthBridge({ password: savedAuth.password, toServer, toViewer, onReady: () => clearTimeout(timer) }) : null;
      peer.on('data', data => {
        try { if (bridge) bridge.fromServer(data); else toViewer(data); }
        catch { finish(1011, 'VNC automatic authentication failed'); }
      });
      ws.on('message', (data, binary) => {
        if (!binary) { finish(1003, 'Binary RFB messages required'); return; }
        try { if (bridge) bridge.fromViewer(data); else toServer(data); }
        catch { finish(1011, 'VNC automatic authentication failed'); }
      });
      ws.on('error', () => finish(1011, 'Viewer failed'));
      ws.once('close', () => { finish(); clients.delete(ws); });
      peer.on('error', () => finish(1011, 'VNC server unavailable'));
      peer.once('end', () => finish(1000, 'VNC server closed'));
    });
  });
  return {
    server,
    async close() {
      stopping = true;
      for (const ws of clients) ws.terminate();
      wss.close();
      await new Promise((done, fail) => {
        server.close(error => error ? fail(error) : done());
        server.closeAllConnections();
      });
    },
  };
}
