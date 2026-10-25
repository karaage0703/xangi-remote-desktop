import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBrowserAuth } from '../src/browser-auth.mjs';

test('local setup, show and rotation preserve password and invalidate old signed registration', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-registration-')); t.after(() => rm(dir, { recursive: true }));
  const passwordFile = join(dir, 'password'), keyFile = join(dir, 'key');
  const password = 'priv1234'; await writeFile(passwordFile, password, { mode: 0o600 });
  const env = { ...process.env, REMOTE_DESKTOP_VNC_PASSWORD_FILE: passwordFile, REMOTE_DESKTOP_BROWSER_KEY_FILE: keyFile, REMOTE_DESKTOP_VNC_PORT: '5900' };
  const run = command => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/registration.mjs', import.meta.url)), command], { env, encoding: 'utf8', cwd: dir });
  const missing = run('show'); assert.equal(missing.status, 1); assert.ok(!missing.stdout.includes(password));
  const setup = run('setup'); assert.equal(setup.status, 0, setup.stderr);
  const first = (await readFile(keyFile, 'utf8')).trim(); assert.match(first, /^[a-f0-9]{64}$/); assert.ok(setup.stdout.includes(first)); assert.ok(!setup.stdout.includes(password));
  assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
  const cookie = createBrowserAuth(first).register(first, true).cookie.split(';')[0];
  assert.ok(run('show').stdout.includes(first)); assert.ok(run('setup').stdout.includes(first));
  const rotated = run('rotate'); assert.equal(rotated.status, 0, rotated.stderr); assert.match(rotated.stdout, /停止・起動/);
  const next = (await readFile(keyFile, 'utf8')).trim(); assert.notEqual(first, next); assert.ok(rotated.stdout.includes(next)); assert.ok(!rotated.stdout.includes(password));
  assert.equal(createBrowserAuth(next).valid({ headers: { cookie } }), false);
  assert.equal(await readFile(passwordFile, 'utf8'), password);
  assert.equal(run('invalid').status, 1); assert.equal((await readFile(keyFile, 'utf8')).trim(), next);
});
