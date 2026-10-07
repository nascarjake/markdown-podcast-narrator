import { mkdir, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, runBuilder, zipFolder } from './builder.mjs';

const release = path.join(root, 'release');
await rm(path.join(release, 'mac-arm64'), { recursive: true, force: true });
await rm(path.join(release, 'portable-mac'), { recursive: true, force: true });
runBuilder(['--mac', 'dir', '--arm64']);

async function findApp(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith('.app')) return fullPath;
    if (entry.isDirectory()) {
      const found = await findApp(fullPath);
      if (found) return found;
    }
  }
  return null;
}

const macOutput = path.join(release, 'mac-arm64');
const app = await findApp(macOutput);
if (!app) throw new Error('electron-builder completed, but the macOS .app bundle was not found.');
const stage = path.join(release, 'portable-mac', 'Markdown Podcast Narrator');
await rm(path.dirname(stage), { recursive: true, force: true });
await mkdir(stage, { recursive: true });
const appCopy = spawnSync('/usr/bin/ditto', [app, path.join(stage, 'Markdown Podcast Narrator.app')], { cwd: root, stdio: 'inherit' });
if (appCopy.error) throw appCopy.error;
if (appCopy.status !== 0) throw new Error('Could not copy the macOS app bundle without changing its framework links.');
const launcher = `#!/bin/bash\nset -euo pipefail\ncd "$(dirname "$0")"\nxattr -c "./Markdown Podcast Narrator.app"\nopen "./Markdown Podcast Narrator.app"\n`;
const commandFile = path.join(stage, 'Start Markdown Podcast Narrator.command');
await writeFile(commandFile, launcher, { mode: 0o755 });
await chmod(commandFile, 0o755);
await writeFile(path.join(stage, 'README.txt'), 'Double-click “Start Markdown Podcast Narrator.command” to clear the downloaded-app quarantine attribute and launch the app.\n\nThis build is ad hoc signed and not notarized. macOS may require you to right-click the command file and choose Open the first time. FFmpeg and a writing provider (LM Studio, Codex CLI, or Claude Code CLI) are required for the corresponding features.\n');
const archive = path.join(release, 'Markdown-Podcast-Narrator-mac-arm64.zip');
await rm(archive, { force: true });
zipFolder(path.dirname(stage), archive);
await rm(macOutput, { recursive: true, force: true });
console.log(`Created ${archive}`);
