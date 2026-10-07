import { localModels, hardwareInfo, modelRecommendations } from '../src/lmstudio.mjs';
import { writeEpisode } from '../src/episode.mjs';

const models = await localModels();
console.log('Installed:', models.map((model) => model.key).join(', '));
console.log('Fits:', modelRecommendations(models, hardwareInfo()).filter((model) => model.fits).map((model) => model.key).join(', '));
const episode = await writeEpisode({
  model: process.argv[2] || 'google/gemma-4-e4b',
  notes: 'A small local podcast app accepts Markdown notes. It uses Kokoro for text-to-speech and FFmpeg to save MP3 files. A local language model can draft a conversation between two hosts. The goal is to help people turn research notes into a clear audio explanation without using a paid API.',
  sources: []
});
console.log(JSON.stringify({ title: episode.title, turns: episode.segments.length, first: episode.segments[0] }, null, 2));
