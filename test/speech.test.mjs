import test from 'node:test';
import assert from 'node:assert/strict';
import { speechChunks, spokenBlocks, titleFromMarkdown } from '../src/speech.mjs';

test('headings, bullets, and links become speakable text', () => {
  const markdown = '# A fresh start\n\n- Read the [guide](https://example.com).\n- Keep this **simple**';
  assert.equal(titleFromMarkdown(markdown), 'A fresh start');
  assert.deepEqual(spokenBlocks(markdown).map((block) => block.text), [
    'A fresh start.', 'Read the guide.', 'Keep this simple.'
  ]);
});

test('front matter and code fences are excluded', () => {
  const markdown = '---\ntitle: hidden\n---\n# Public title\n```js\nsecret()\n```\nA paragraph.';
  assert.deepEqual(spokenBlocks(markdown).map((block) => block.text), ['Public title.', 'A paragraph.']);
});

test('long text is split into model-sized chunks without losing words', () => {
  const words = Array.from({ length: 120 }, (_, i) => `word${i}`);
  const chunks = speechChunks(words.join(' '));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 260));
  assert.deepEqual(chunks.flatMap((chunk) => chunk.text.replace(/\.$/, '').split(' ')), words);
});
