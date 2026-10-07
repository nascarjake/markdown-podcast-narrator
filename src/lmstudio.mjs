import os from 'node:os';
import path from 'node:path';
import { existsSync, statfsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const base = 'http://127.0.0.1:1234';
const catalog = [
  { key: 'qwen/qwen3.5-35b-a3b', name: 'Qwen3.5 35B A3B', sizeBytes: 22_000_000_000, note: 'Large local model for detailed scripts; uses substantial memory', tier: 'quality' },
  { key: 'google/gemma-4-e4b', name: 'Gemma 4 E4B', sizeBytes: 6_300_000_000, note: 'Balanced writing and speed', tier: 'balanced' },
  { key: 'nvidia/nemotron-3-nano-4b', name: 'Nemotron 3 Nano 4B', sizeBytes: 2_800_000_000, note: 'Fast and light; simpler scripts', tier: 'fast' }
];

function lmsPath() {
  const local = path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
  return existsSync(local) ? local : 'lms';
}

export async function ensureServer() {
  try {
    const response = await fetch(`${base}/api/v1/models`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) return;
  } catch { /* start local server */ }
  try {
    await execFileAsync(lmsPath(), ['server', 'start', '--port', '1234', '--bind', '127.0.0.1'], { timeout: 25000 });
  } catch (error) {
    throw new Error(`LM Studio is unavailable. Open LM Studio and start its local server. ${error.message}`);
  }
}

export async function localModels() {
  await ensureServer();
  const response = await fetch(`${base}/api/v1/models`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`LM Studio model list returned ${response.status}.`);
  const data = await response.json();
  return (data.models || []).filter((model) => model.type === 'llm').map((model) => ({
    key: model.key,
    name: model.display_name || model.key,
    sizeBytes: model.size_bytes || 0,
    quantization: model.quantization?.name || model.format || '',
    loaded: Boolean(model.loaded_instances?.length)
  }));
}

export function hardwareInfo() {
  const ramBytes = os.totalmem();
  let freeDiskBytes = 0;
  try {
    const info = statfsSync(os.homedir());
    freeDiskBytes = info.bavail * info.bsize;
  } catch { /* disk estimate unavailable */ }
  return { ramBytes, freeDiskBytes, chip: os.cpus()[0]?.model || process.arch };
}

export function modelRecommendations(models, hardware = hardwareInfo()) {
  return catalog.map((item) => {
    const installed = models.find((model) => model.key === item.key);
    const sizeBytes = installed?.sizeBytes || item.sizeBytes;
    const enoughMemory = hardware.ramBytes >= Math.max(8_000_000_000, sizeBytes * 1.35 + 4_000_000_000);
    const enoughDisk = Boolean(installed) || !hardware.freeDiskBytes || hardware.freeDiskBytes >= sizeBytes + 2_000_000_000;
    return { ...item, sizeBytes, installed: Boolean(installed), fits: enoughMemory && enoughDisk, reason: !enoughMemory ? 'Needs more memory' : !enoughDisk ? 'Needs more disk space' : 'Estimated fit' };
  });
}

export async function ensureModelLoaded(modelKey) {
  const models = await localModels();
  const selected = models.find((model) => model.key === modelKey);
  if (!selected) throw new Error('Choose a model installed in LM Studio.');
  if (selected.loaded) return;
  const response = await fetch(`${base}/api/v1/models/load`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelKey, context_length: 8192, flash_attention: true }),
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LM Studio could not load ${selected.name}: ${detail.slice(0, 300)}`);
  }
}

export async function downloadModel(modelKey) {
  if (typeof modelKey !== 'string' || !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?:@[a-z0-9_]+)?$/i.test(modelKey)) {
    throw new Error('Enter a model catalog ID such as qwen/qwen3.5-9b.');
  }
  await ensureServer();
  const response = await fetch(`${base}/api/v1/models/download`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelKey }), signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`LM Studio could not start the download: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

export async function downloadStatus(jobId) {
  if (!/^job_[a-z0-9]+$/i.test(jobId)) throw new Error('Invalid download job.');
  const response = await fetch(`${base}/api/v1/models/download/status/${jobId}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`LM Studio download status returned ${response.status}.`);
  return response.json();
}

export async function chatCompletion(request) {
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(240000)
  });
  if (!response.ok) throw new Error(`LM Studio generation failed: ${(await response.text()).slice(0, 400)}`);
  return response.json();
}
