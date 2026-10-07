import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { root, runBuilder, zipFolder } from './builder.mjs';

const release = path.join(root, 'release');
await rm(path.join(release, 'win-unpacked'), { recursive: true, force: true });
await rm(path.join(release, 'portable-windows'), { recursive: true, force: true });
runBuilder(['--win', 'dir', '--x64']);

async function findWindowsApp(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.toLowerCase().endsWith('-unpacked')) return fullPath;
    if (entry.isDirectory() && entry.name !== 'portable-mac') {
      const found = await findWindowsApp(fullPath);
      if (found) return found;
    }
  }
  return null;
}

const built = await findWindowsApp(release);
if (!built) throw new Error('electron-builder completed, but the Windows x64 app folder was not found.');
const stage = path.join(release, 'portable-windows', 'Markdown Podcast Narrator for Windows');
await rm(path.dirname(stage), { recursive: true, force: true });
await mkdir(path.dirname(stage), { recursive: true });
await cp(built, stage, { recursive: true });
const archive = path.join(release, 'Markdown-Podcast-Narrator-windows-x64.zip');
await rm(archive, { force: true });
zipFolder(stage, archive);
await rm(built, { recursive: true, force: true });
console.log(`Created ${archive}`);
