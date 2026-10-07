import { parentPort, workerData } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { env } from '@huggingface/transformers';
import { speechChunks } from './speech.mjs';

// ONNX Runtime needs an ordinary filesystem path; models cannot be loaded from app.asar.
env.cacheDir = workerData.modelCacheDir;
const { KokoroTTS } = await import('kokoro-js');

let model;
const sampleRate = 24000;

function progress(jobId, message, current = 0, total = 0) {
  parentPort.postMessage({ type: 'progress', jobId, message, current, total });
}

async function getModel(jobId) {
  if (!model) {
    progress(jobId, 'Loading Kokoro (downloads the model once if needed)…');
    model = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
      device: 'cpu'
    });
  }
  return model;
}

async function writeToEncoder(encoder, bytes) {
  if (!encoder.stdin.write(bytes)) await once(encoder.stdin, 'drain');
}

async function run({ jobId, markdown, segments, voiceA, voiceB, target, ffmpegPath }) {
  const chunks = segments
    ? segments.flatMap((part) => speechChunks(part.text).map((chunk) => ({ ...chunk, voice: part.speaker === 'A' ? voiceA : voiceB, pauseMs: 300 })))
    : speechChunks(markdown).map((chunk) => ({ ...chunk, voice: voiceA }));
  if (!chunks.length) throw new Error('No speakable text was found. Add a heading, paragraph, or bullet point.');
  const tts = await getModel(jobId);
  const partial = `${target}.partial.mp3`;
  const encoder = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0',
    '-codec:a', 'libmp3lame', '-qscale:a', '3', partial
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let errorText = '';
  encoder.stderr.on('data', (part) => { errorText += part.toString(); });
  encoder.stdin.on('error', () => {});
  const finished = new Promise((resolve, reject) => {
    encoder.once('error', reject);
    encoder.once('close', (code) => code === 0 ? resolve() : reject(new Error(errorText.trim() || `FFmpeg exited with code ${code}.`)));
  });
  try {
    for (let i = 0; i < chunks.length; i++) {
      progress(jobId, `Narrating section ${i + 1} of ${chunks.length}…`, i, chunks.length);
      const rendered = await tts.generate(chunks[i].text, { voice: chunks[i].voice });
      if (!(rendered.audio instanceof Float32Array) || rendered.sampling_rate !== sampleRate) {
        throw new Error('Kokoro returned audio in an unexpected format.');
      }
      const samples = rendered.audio;
      await writeToEncoder(encoder, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
      const silence = Buffer.alloc(Math.round(sampleRate * chunks[i].pauseMs / 1000) * 4);
      await writeToEncoder(encoder, silence);
    }
    encoder.stdin.end();
    await finished;
    await rename(partial, target);
    progress(jobId, 'Saved MP3.', chunks.length, chunks.length);
  } catch (error) {
    encoder.kill();
    await finished.catch(() => {});
    await rm(partial, { force: true });
    throw error;
  }
}

parentPort.on('message', async (job) => {
  try {
    await run(job);
    parentPort.postMessage({ type: 'done', jobId: job.jobId });
  } catch (error) {
    parentPort.postMessage({ type: 'error', jobId: job.jobId, error: error.message || String(error) });
  }
});
