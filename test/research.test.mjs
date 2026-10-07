import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { searchCodebase } from '../src/research.mjs';

test('codebase research finds relevant lines without reading dependency or secret files', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'podcast-research-'));
  try {
    await mkdir(path.join(folder, 'node_modules'));
    await writeFile(path.join(folder, 'README.md'), 'Kokoro generates the podcast audio.');
    await writeFile(path.join(folder, '.env'), 'KOKORO_TOKEN=not-for-the-prompt');
    await writeFile(path.join(folder, 'node_modules', 'noise.js'), 'Kokoro irrelevant dependency');
    const sources = await searchCodebase(folder, 'Kokoro podcast');
    assert.deepEqual(sources.map((source) => source.title), ['README.md']);
    assert.match(sources[0].excerpt, /Kokoro generates/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
