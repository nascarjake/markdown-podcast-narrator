import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root } from './builder.mjs';

for (const script of ['build-mac.mjs', 'build-windows.mjs']) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status ?? 'unknown'}.`);
}
