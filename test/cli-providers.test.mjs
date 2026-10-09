import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCliEpisode, runCliStructured } from '../src/cli-providers.mjs';
import { parseEpisode, parsePlan, PLAN_SCHEMA } from '../src/episode.mjs';

test('Codex and Claude CLI adapters pass input by stdin and parse structured episodes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'podcast-cli-test-'));
  const binary = path.join(dir, 'fake-cli');
  const episode = { title: 'Synthetic', segments: [
    { speaker: 'A', text: 'A first point.' }, { speaker: 'B', text: 'A question?' },
    { speaker: 'A', text: 'An answer.' }, { speaker: 'B', text: 'A takeaway.' }
  ] };
  const plan = { title: 'Synthetic', concepts: [{ name: 'One idea', groundedPoint: 'A supported point', everydayBridge: 'A familiar example' }] };
  await writeFile(binary, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const input = fs.readFileSync(0, 'utf8');
if (!input.includes('private synthetic marker') || args.some(arg => arg.includes('private synthetic marker'))) process.exit(9);
const episode = ${JSON.stringify(episode)};
const plan = ${JSON.stringify(plan)};
const schema = args.includes('--output-schema')
  ? JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'))
  : JSON.parse(args[args.indexOf('--json-schema') + 1]);
const response = schema.properties.concepts ? plan : episode;
if (args.includes('exec')) {
  if (!args.includes('model_reasoning_effort=high') || !args.includes('read-only') || !args.includes('--ephemeral')) process.exit(8);
  fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify(response));
} else {
  if (!args.includes('--model') || !args.includes('--safe-mode') || args.includes('--bare') || !args.includes('--no-session-persistence') || !args.includes('--disallowedTools')) process.exit(7);
  process.stdout.write(JSON.stringify({ is_error: false, structured_output: response }));
}
`);
  await chmod(binary, 0o755);
  try {
    const codex = await runCliEpisode({ provider: 'codex', model: 'gpt-6-astra', effort: 'high', prompt: 'private synthetic marker', binaryOverride: binary });
    const claude = await runCliEpisode({ provider: 'claude', model: 'sonnet', prompt: 'private synthetic marker', binaryOverride: binary });
    const codexPlan = await runCliStructured({ provider: 'codex', model: 'gpt-6-astra', effort: 'high', prompt: 'private synthetic marker', schema: PLAN_SCHEMA, binaryOverride: binary });
    const claudePlan = await runCliStructured({ provider: 'claude', model: 'sonnet', prompt: 'private synthetic marker', schema: PLAN_SCHEMA, binaryOverride: binary });
    assert.deepEqual(parseEpisode(codex), episode);
    assert.deepEqual(parseEpisode(claude), episode);
    assert.deepEqual(parsePlan(codexPlan), plan);
    assert.deepEqual(parsePlan(claudePlan), plan);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
