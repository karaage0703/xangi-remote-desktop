import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const dir of ['src', 'scripts', 'public', 'test']) {
  for (const file of await readdir(resolve(root, dir))) {
    if (!/\.(mjs|js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', resolve(root, dir, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
for (const file of ['package.json', 'xangi-extension.json']) JSON.parse(await readFile(resolve(root, file)));
console.log('JavaScript syntax and JSON checks passed.');
