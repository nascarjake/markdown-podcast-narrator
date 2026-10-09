import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeEpisode } from '../src/episode.mjs';

test('draft length and section count grow with the number of hard concepts', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'podcast-length-'));
  const binary = path.join(folder, 'codex');
  const log = path.join(folder, 'calls.jsonl');
  const priorPath = process.env.PATH;
  await writeFile(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const prompt = fs.readFileSync(0, 'utf8');
const schema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
const planning = Boolean(schema.properties.concepts);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ planning }) + '\\n');
let answer;
if (planning) {
  const count = prompt.includes('TEN_TOPICS') ? 10 : prompt.includes('THREE_OUTLINED') ? 5 : 3;
  answer = { title: 'A gentle explanation', concepts: Array.from({ length: count }, (_, index) => ({
    name: 'Concept ' + (index + 1), groundedPoint: 'Supported detail.', everydayBridge: 'A familiar example.'
  })) };
} else {
  const target = Number(prompt.match(/Write about (\\d+) spoken words/)[1]);
  const range = prompt.match(/Explain concepts (\\d+)–(\\d+) of/);
  const example = 'A familiar example makes this idea easier to understand. ';
  const text = 'Concepts ' + range[1] + ' to ' + range[2] + '. ' + example.repeat(Math.ceil(target / 40));
  answer = { title: 'A gentle explanation', segments: ['A', 'B', 'A', 'B'].map((speaker) => ({ speaker, text })) };
}
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify(answer));
`);
  await chmod(binary, 0o755);
  process.env.PATH = `${folder}${path.delimiter}${priorPath || ''}`;
  try {
    const draft = (notes) => writeEpisode({ provider: 'codex', model: 'gpt-6-astra', effort: 'low', notes, sources: [] });
    const three = await draft('THREE_TOPICS');
    const ten = await draft('TEN_TOPICS');
    const outlined = await draft('THREE_OUTLINED\n1. First major subject.\n2. Second major subject.\n3. Third major subject.');
    const words = (episode) => episode.segments.map((part) => part.text).join(' ').trim().split(/\s+/).length;
    assert.equal(three.conceptCount, 3);
    assert.equal(ten.conceptCount, 10);
    assert.equal(outlined.conceptCount, 3);
    assert.ok(ten.targetWords / three.targetWords > 3);
    assert.ok(words(ten) / words(three) > 2.8);
    assert.equal(ten.segments.length, 16);
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter((call) => call.planning).length, 3);
    assert.equal(calls.filter((call) => !call.planning).length, 6);
  } finally {
    process.env.PATH = priorPath;
    await rm(folder, { recursive: true, force: true });
  }
});
