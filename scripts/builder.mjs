import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function nodeMajor(binary) {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const match = result.stdout.match(/v(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const version = match.slice(1).map(Number);
  return { major: version[0], minor: version[1], patch: version[2] };
}

function findBuilderNode() {
  const candidates = [process.env.NODE22_BIN, process.execPath, '/opt/homebrew/opt/node@22/bin/node', '/usr/local/opt/node@22/bin/node'].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const version = nodeMajor(candidate);
    if (version && (version.major > 22 || (version.major === 22 && version.minor >= 12))) return candidate;
  }
  throw new Error('Packaging needs Node.js 22.12 or newer. Install it or set NODE22_BIN to its node executable.');
}

export function runBuilder(args) {
  const node = findBuilderNode();
  const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
  const result = spawnSync(node, [cli, '--config', 'electron-builder.config.cjs', '--publish', 'never', ...args], {
    cwd: root, stdio: 'inherit', env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`electron-builder failed with exit code ${result.status ?? 'unknown'}.`);
}

export function zipFolder(folder, output) {
  const result = spawnSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', folder, output], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not create ${path.basename(output)}.`);
}
