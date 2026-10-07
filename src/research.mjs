import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ignoredDirectories = new Set(['.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'coverage', '.next', '.venv', 'venv', '__pycache__', '.worklog']);
const allowedExtensions = new Set(['.md', '.txt', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rs', '.go', '.java', '.json', '.yaml', '.yml', '.toml', '.css', '.html', '.sh']);
const ignoredFiles = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']);

function decodeHtml(text) {
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (_, hex, dec) => String.fromCodePoint(parseInt(hex || dec, hex ? 16 : 10)));
}

function plainText(html) {
  return decodeHtml(html
    .replace(/<(script|style|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')).trim();
}

export function topicTerms(topic) {
  const stop = new Set(['about', 'after', 'again', 'also', 'from', 'have', 'into', 'more', 'notes', 'that', 'their', 'there', 'these', 'this', 'what', 'when', 'where', 'which', 'with', 'your']);
  return [...new Set((topic.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || []).filter((word) => !stop.has(word)))].slice(0, 10);
}

export async function searchCodebase(folder, topic) {
  const terms = topicTerms(topic);
  const candidates = [];
  const stack = [folder];
  let inspected = 0;
  while (stack.length && inspected < 1500) {
    const directory = stack.pop();
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile() || ignoredFiles.has(entry.name) || !allowedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      if (/^(\.env|.*(?:secret|credential|private.key|id_rsa))/i.test(entry.name)) continue;
      inspected++;
      try {
        if ((await stat(full)).size > 300_000) continue;
        const content = await readFile(full, 'utf8');
        if (content.includes('\0')) continue;
        const lines = content.split(/\r?\n/);
        const hits = [];
        for (let i = 0; i < lines.length && hits.length < 4; i++) {
          const score = terms.reduce((sum, term) => sum + (lines[i].toLowerCase().includes(term) ? 1 : 0), 0);
          if (score) hits.push({ line: i + 1, text: lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2)).join(' ').slice(0, 500), score });
        }
        const pathScore = terms.reduce((sum, term) => sum + (entry.name.toLowerCase().includes(term) ? 2 : 0), 0);
        if (hits.length || pathScore) candidates.push({ file: full, relative: path.relative(folder, full), hits, score: hits.reduce((sum, hit) => sum + hit.score, pathScore) });
      } catch { /* unreadable file */ }
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 8).map((item, index) => ({
    id: `C${index + 1}`,
    title: item.relative,
    location: item.file,
    kind: 'code',
    excerpt: item.hits.length ? item.hits.map((hit) => `Line ${hit.line}: ${hit.text}`).join('\n') : item.relative
  }));
}

export async function searchWikipedia(query) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: query.slice(0, 180), srlimit: '2', format: 'json' }).toString();
  const response = await fetch(url, { headers: { 'user-agent': 'MarkdownPodcastNarrator/0.1 (local personal research app)' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Wikipedia search returned ${response.status}.`);
  const data = await response.json();
  const results = data.query?.search || [];
  if (!results.length) return [];
  const extractUrl = new URL('https://en.wikipedia.org/w/api.php');
  extractUrl.search = new URLSearchParams({ action: 'query', prop: 'extracts', explaintext: '1', pageids: results.map((result) => result.pageid).join('|'), format: 'json' }).toString();
  const extractResponse = await fetch(extractUrl, { headers: { 'user-agent': 'MarkdownPodcastNarrator/0.1 (local personal research app)' }, signal: AbortSignal.timeout(12000) });
  const extracts = extractResponse.ok ? (await extractResponse.json()).query?.pages || {} : {};
  return results.map((result, index) => ({
    id: `W${index + 1}`,
    title: result.title,
    location: `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title.replaceAll(' ', '_'))}`,
    kind: 'web',
    excerpt: String(extracts[result.pageid]?.extract || plainText(result.snippet)).slice(0, 4000)
  }));
}

export async function readWebUrl(raw, index) {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`Invalid source URL: ${raw}`); }
  if (url.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|172\.|\[|.*\.local$)/i.test(url.hostname)) {
    throw new Error('Source links must be public HTTPS URLs.');
  }
  const response = await fetch(url, { redirect: 'error', headers: { 'user-agent': 'MarkdownPodcastNarrator/0.1' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Could not read ${url.hostname}: HTTP ${response.status}.`);
  const type = response.headers.get('content-type') || '';
  if (!/text\/html|text\/plain|application\/json/.test(type)) throw new Error(`Unsupported page type from ${url.hostname}.`);
  if (Number(response.headers.get('content-length')) > 500_000) throw new Error(`Page from ${url.hostname} is too large.`);
  const reader = response.body.getReader();
  let bytes = 0;
  const parts = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 500_000) throw new Error(`Page from ${url.hostname} is too large.`);
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = Buffer.concat(parts).toString('utf8');
  const title = decodeHtml(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url.hostname).trim();
  return { id: `U${index + 1}`, title, location: url.href, kind: 'web', excerpt: plainText(body).slice(0, 4000) };
}
