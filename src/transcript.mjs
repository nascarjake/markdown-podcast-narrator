export function parseDialogue(text) {
  const segments = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:HOST\s*)?([AB])\s*:\s*(.*)$/i);
    if (match) segments.push({ speaker: match[1].toUpperCase(), text: match[2].trim() });
    else if (segments.length && line.trim()) segments[segments.length - 1].text += ` ${line.trim()}`;
  }
  return segments.length >= 2 && new Set(segments.map((part) => part.speaker)).size === 2 ? segments : null;
}

export function episodeToMarkdown(episode) {
  return `# ${episode.title}\n\n${episode.segments.map((part) => `HOST ${part.speaker}: ${part.text}`).join('\n\n')}`;
}
