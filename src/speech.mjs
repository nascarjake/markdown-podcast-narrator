const MAX_CHARS = 260;

export function titleFromMarkdown(markdown) {
  const heading = markdown.match(/^\s*#{1,6}\s+(.+)$/m)?.[1];
  const firstLine = markdown.split(/\r?\n/).find((line) => line.trim());
  return cleanInline(heading || firstLine || 'Untitled narration').slice(0, 80) || 'Untitled narration';
}

function cleanInline(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<https?:\/\/[^>]+>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/&amp;/g, 'and')
    .replace(/&lt;/g, 'less than')
    .replace(/&gt;/g, 'greater than')
    .replace(/\s+/g, ' ')
    .trim();
}

export function spokenBlocks(markdown) {
  if (typeof markdown !== 'string') throw new TypeError('Markdown must be text.');
  const blocks = [];
  let inFence = false;
  let inFrontMatter = false;
  let seenContent = false;

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!seenContent && line === '---') { inFrontMatter = true; seenContent = true; continue; }
    if (inFrontMatter) { if (line === '---') inFrontMatter = false; continue; }
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence || !line || /^<!--/.test(line) || /^[-*_]{3,}$/.test(line)) continue;
    if (/^\|?\s*:?-{3,}/.test(line)) continue;
    seenContent = true;

    const heading = /^#{1,6}\s+/.test(line);
    let text = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^([-*+]|\d+[.)])\s+/, '')
      .replace(/^\[([ xX])\]\s+/, '')
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .replace(/\s*\|\s*/g, ', ');
    text = cleanInline(text);
    if (!text) continue;
    if (!/[.!?…:]$/.test(text)) text += '.';
    blocks.push({ text, pauseMs: heading ? 450 : 180 });
  }
  return blocks;
}

export function speechChunks(markdown) {
  const chunks = [];
  for (const block of spokenBlocks(markdown)) {
    const sentences = block.text.match(/[^.!?…]+[.!?…]*/g) || [block.text];
    let current = '';
    const flush = () => {
      if (current) chunks.push({ text: current.trim(), pauseMs: block.pauseMs });
      current = '';
    };
    for (const sentence of sentences) {
      for (const word of sentence.trim().split(/\s+/)) {
        if (word.length > MAX_CHARS) {
          flush();
          for (let at = 0; at < word.length; at += MAX_CHARS) {
            chunks.push({ text: word.slice(at, at + MAX_CHARS), pauseMs: block.pauseMs });
          }
          continue;
        }
        if (current && (current.length + word.length + 1 > MAX_CHARS)) flush();
        current += (current ? ' ' : '') + word;
      }
    }
    flush();
  }
  return chunks;
}
