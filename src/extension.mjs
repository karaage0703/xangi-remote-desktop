import { loadEnvFile } from 'node:process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSavedAuth } from './browser-auth.mjs';
import { readConfig } from './config.mjs';
import { createDesktopServer } from './server.mjs';

if (process.argv[2] !== 'serve') throw new Error('Use the xangi managed extension launcher');
const token = process.env.XANGI_EXTENSION_AUTH_TOKEN;
// This file only supplies configuration. The host's authentication token is captured first.
try { loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await access(new URL('../dist/index.html', import.meta.url));
const at = process.argv.indexOf('--workspace');
if (at >= 0 && !process.argv[at + 1]) throw new Error('--workspace needs a path');
const workspace = resolve(at >= 0 ? process.argv[at + 1] : process.cwd());
const app = createDesktopServer({ token, config: readConfig(), savedAuth: await loadSavedAuth(process.env) });
app.server.listen(0, '127.0.0.1', () => {
  console.log(JSON.stringify({ schemaVersion: 2, event: 'ready', id: 'xangi-remote-desktop', workspace, baseUrl: `http://127.0.0.1:${app.server.address().port}` }));
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  process.stdin.pause();
  await app.close();
}
process.stdin.resume();
process.stdin.on('end', () => void stop());
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop());
