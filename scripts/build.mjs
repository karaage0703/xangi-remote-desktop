import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const pkg = JSON.parse(await readFile(resolve(root, 'node_modules/@novnc/novnc/package.json')));
if (pkg.version !== '1.7.0') throw new Error('Recheck noVNC API and licenses before updating');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, 'public'), dist, { recursive: true });
// Preserve unmodified, readable source and every bundled notice, including pako.
await cp(resolve(root, 'node_modules/@novnc/novnc'), resolve(dist, 'vendor/novnc'), { recursive: true });
await mkdir(resolve(dist, 'licenses'), { recursive: true });
await cp(resolve(root, 'node_modules/ws/LICENSE'), resolve(dist, 'licenses/ws.txt'));
await cp(resolve(root, 'LICENSE'), resolve(dist, 'licenses/xangi-remote-desktop.txt'));
await writeFile(resolve(dist, 'licenses/README.txt'), 'noVNC 1.7.0 is provided unmodified under MPL-2.0 and the notices in ../vendor/novnc/LICENSE.txt. Its complete npm package source is served at ../vendor/novnc/ (entry: core/rfb.js). Upstream: https://github.com/novnc/noVNC/tree/v1.7.0 . ws 8.22.0 is MIT; see ws.txt. xangi-remote-desktop original code is MIT.\n');
console.log('Built UI, unmodified noVNC sources and third-party licenses.');
