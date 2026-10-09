import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_MODELS = {
  codex: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  claude: ['sonnet', 'opus', 'haiku']
};
export const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export const EPISODE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' },
    segments: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: { speaker: { type: 'string', enum: ['A', 'B'] }, text: { type: 'string' } },
      required: ['speaker', 'text']
    } }
  },
  required: ['title', 'segments']
};

function binaryCandidates(name) {
  const paths = (process.env.PATH || '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, name));
  const home = os.homedir();
  const common = [fileURLToPath(new URL(`../node_modules/.bin/${name}`, import.meta.url)), path.join(home, '.local', 'bin', name), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`];
  if (name === 'codex') common.push('/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex');
  return [...new Set([...paths, ...common])];
}

export async function findCli(name) {
  for (const candidate of binaryCandidates(name)) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* try next location */ }
  }
  return null;
}

function isSignedIn(binary, args) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(false); }, 10_000);
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

export async function cliStatus() {
  const [codex, claude] = await Promise.all([findCli('codex'), findCli('claude')]);
  const [codexSignedIn, claudeSignedIn] = await Promise.all([
    codex ? isSignedIn(codex, ['login', 'status']) : false,
    claude ? isSignedIn(claude, ['auth', 'status']) : false
  ]);
  return { codex: { installed: !!codex, signedIn: codexSignedIn }, claude: { installed: !!claude, signedIn: claudeSignedIn }, models: CLI_MODELS, efforts: CODEX_EFFORTS };
}

function run(binary, args, input, cwd, timeoutMs = 300_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env: { ...process.env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('The writing CLI timed out after five minutes.')); }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 2_000_000) child.kill('SIGKILL'); });
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 200_000) stderr = stderr.slice(-200_000); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (stdout.length > 2_000_000) return reject(new Error('The writing CLI returned too much output.'));
      if (code !== 0) return reject(new Error(`${path.basename(binary)} exited with code ${code}: ${stderr.trim().slice(-1200) || stdout.trim().slice(-1200) || 'Check that the CLI is signed in and the model is available.'}`));
      resolve({ stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function runCliStructured({ provider, model, effort = 'medium', prompt, schema, binaryOverride }) {
  if (!['codex', 'claude'].includes(provider)) throw new Error('Unknown writing provider.');
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(model)) throw new Error('Enter a valid model name.');
  if (provider === 'codex' && !CODEX_EFFORTS.includes(effort)) throw new Error('Choose a supported Codex effort level.');
  const binary = binaryOverride || await findCli(provider);
  if (!binary) throw new Error(`${provider === 'codex' ? 'Codex' : 'Claude'} CLI is not installed. Install it and sign in, then refresh providers.`);
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'podcast-writer-'));
  try {
    if (provider === 'codex') {
      const schemaFile = path.join(cwd, 'schema.json');
      const answerFile = path.join(cwd, 'episode.json');
      await writeFile(schemaFile, JSON.stringify(schema));
      const args = ['-a', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--model', model, '--config', `model_reasoning_effort=${effort}`, '--output-schema', schemaFile, '--output-last-message', answerFile, '-'];
      await run(binary, args, prompt, cwd);
      return await readFile(answerFile, 'utf8');
    }
    const args = ['--safe-mode', '-p', 'Follow the piped podcast production instructions and return the requested JSON.', '--model', model, '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--no-session-persistence', '--tools', '', '--disallowedTools', '*'];
    const { stdout } = await run(binary, args, prompt, cwd);
    const result = JSON.parse(stdout);
    if (result.is_error) throw new Error(result.result || 'Claude could not draft the episode.');
    return JSON.stringify(result.structured_output ?? JSON.parse(result.result));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export function runCliEpisode(options) {
  return runCliStructured({ ...options, schema: EPISODE_SCHEMA });
}
