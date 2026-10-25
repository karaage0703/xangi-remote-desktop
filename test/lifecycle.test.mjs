import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('managed launcher announces the workspace and exits when its parent closes stdin', { timeout: 8000, skip: process.platform === 'win32' }, async t => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const child = spawn('./scripts/xangi-extension', ['serve', '--workspace', cwd], {
    cwd,
    env: { ...process.env, XANGI_EXTENSION_AUTH_TOKEN: 'test-lifecycle-managed-token-12345678', REMOTE_DESKTOP_VNC_PORT: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  const exited = once(child, 'exit');
  const lines = createInterface({ input: child.stdout });
  const [line] = await once(lines, 'line');
  const ready = JSON.parse(line);
  assert.equal(ready.schemaVersion, 2);
  assert.equal(ready.id, 'xangi-remote-desktop');
  assert.equal(ready.workspace, cwd.replace(/\/$/, ''));
  assert.match(ready.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  child.stdin.end();
  assert.equal((await exited)[0], 0);
});
