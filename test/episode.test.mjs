import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEpisode, SYSTEM_PROMPT } from '../src/episode.mjs';
import { parseDialogue, episodeToMarkdown } from '../src/transcript.mjs';
import { modelRecommendations } from '../src/lmstudio.mjs';

test('structured episode becomes editable, two-host dialogue', () => {
  const episode = parseEpisode(JSON.stringify({ title: 'Sample', segments: [
    { speaker: 'A', text: 'Here is the first idea.' }, { speaker: 'B', text: 'Why does it matter?' },
    { speaker: 'A', text: 'It saves time.' }, { speaker: 'B', text: 'That is useful.' }
  ] }));
  assert.deepEqual(parseDialogue(episodeToMarkdown(episode)), episode.segments);
  assert.match(SYSTEM_PROMPT, /untrusted source material/);
});

test('recommendations respect memory and available disk', () => {
  const lowEnd = modelRecommendations([], { ramBytes: 8_000_000_000, freeDiskBytes: 5_000_000_000, chip: 'test' });
  assert.equal(lowEnd.find((model) => model.tier === 'quality').fits, false);
  assert.equal(lowEnd.find((model) => model.tier === 'fast').fits, true);
});
