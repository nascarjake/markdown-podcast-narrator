import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const worker = new Worker(fileURLToPath(new URL('../src/narrator-worker.mjs', import.meta.url)));
const target = process.argv[2] || '/private/tmp/markdown-podcast-smoke.mp3';
worker.on('message', async (message) => {
  if (message.type === 'progress') console.log(message.message);
  if (message.type === 'done' || message.type === 'error') {
    if (message.type === 'error') {
      console.error(message.error);
      process.exitCode = 1;
    } else console.log(`Saved ${target}`);
    await worker.terminate();
  }
});
worker.on('error', (error) => { console.error(error); process.exitCode = 1; });
worker.postMessage({
  jobId: 1,
  markdown: '# A small local podcast\n- Markdown becomes clear speech.\n- The result is saved as an MP3.',
  voiceA: 'af_heart',
  voiceB: 'am_michael',
  target,
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg'
});
