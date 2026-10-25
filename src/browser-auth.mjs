import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { open, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

export async function readPrivateFile(path) {
  if (!isAbsolute(path)) throw Error('Credential file must have an absolute path');
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 4096 || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) {
      throw Error('Credential file must be owner-only (0600) and owned by this process user');
    }
    return (await file.readFile('utf8')).replace(/\r?\n$/, '');
  } finally { await file.close(); }
}
export async function loadSavedAuth(env) {
  if (!env.REMOTE_DESKTOP_VNC_PASSWORD_FILE) return null;
  const password = await readPrivateFile(env.REMOTE_DESKTOP_VNC_PASSWORD_FILE);
  if (!/^[\x20-\x7e]{1,8}$/.test(password)) throw Error('Saved VNC password must be 1–8 printable ASCII characters');
  const path = env.REMOTE_DESKTOP_BROWSER_KEY_FILE;
  if (!path || !isAbsolute(path)) throw Error('REMOTE_DESKTOP_BROWSER_KEY_FILE must be an absolute path');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(randomBytes(32).toString('hex') + '\n'); } finally { await file.close(); }
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const key = await readPrivateFile(path);
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error('Browser registration key must be 64 lowercase hex characters');
  return { password, auth: createBrowserAuth(key, env.REMOTE_DESKTOP_COOKIE_SECURE !== 'false') };
}
export function createBrowserAuth(key, secure = true, now = Date.now) {
  const ttl = 30 * 24 * 60 * 60;
  const persistentTtl = 400 * 24 * 60 * 60;
  const equal = (a, b) => {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  const sign = data => createHmac('sha256', key).update(data).digest('hex');
  const cookie = (value, maxAge) => `desktop_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  let failures = 0, resetAt = 0;
  return {
    valid(req) {
      const token = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith('desktop_session='))?.slice(16) || '';
      const [expires, nonce, mac, extra] = token.split('.');
      if (extra || !/^(?:\d{13}|never)$/.test(expires || '') || !/^[a-f0-9]{32}$/.test(nonce || '') || !/^[a-f0-9]{64}$/.test(mac || '')) return false;
      return (expires === 'never' || (Number(expires) > now() && Number(expires) <= now() + ttl * 1000)) && equal(mac, sign(`${expires}.${nonce}`));
    },
    renewCookie(req) {
      if (!this.valid(req)) return null;
      const token = req.headers.cookie.split(/;\s*/).find(c => c.startsWith('desktop_session=')).slice(16);
      return token.startsWith('never.') ? cookie(token, persistentTtl) : null;
    },
    register(code, permanent = false) {
      if (typeof permanent !== 'boolean') return { status: 400 };
      if (now() >= resetAt) { failures = 0; resetAt = now() + 60_000; }
      if (failures >= 5) return { status: 429 };
      if (typeof code !== 'string' || !equal(code, key)) { failures++; return { status: 403 }; }
      const data = `${permanent ? 'never' : now() + ttl * 1000}.${randomBytes(16).toString('hex')}`;
      return { status: 200, cookie: cookie(`${data}.${sign(data)}`, permanent ? persistentTtl : ttl) };
    },
    clearCookie: () => cookie('', 0),
  };
}
