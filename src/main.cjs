const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { Worker } = require('node:worker_threads');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

let window;
let worker;
let busy = false;
let nextJob = 0;
let selectedFolder = '';
const lmstudio = () => import('./lmstudio.mjs');
const episode = () => import('./episode.mjs');
const cliProviders = () => import('./cli-providers.mjs');
const research = () => import('./research.mjs');
const outputDir = () => path.join(app.getPath('music'), 'Markdown Podcast Narrator');

function createWindow() {
  window = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: '#0d0b12',
    title: 'Markdown Podcast Narrator',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  window.loadFile(path.join(__dirname, 'index.html'));
}

function narratorWorker() {
  if (!worker) {
    worker = new Worker(path.join(__dirname, 'narrator-worker.mjs'));
    worker.on('exit', () => { worker = undefined; });
  }
  return worker;
}

function makeOutputPath(title) {
  const safe = title.normalize('NFKD').replace(/[^a-zA-Z0-9 -]/g, '').trim().replace(/\s+/g, '-').slice(0, 56) || 'narration';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(outputDir(), { recursive: true });
  return path.join(outputDir(), `${safe}-${stamp}.mp3`);
}

function findFfmpeg() {
  const candidates = ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-version'], { encoding: 'utf8', timeout: 5000 });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error('FFmpeg is required to make MP3 files. Install FFmpeg, then restart this app.');
}

app.whenReady().then(() => {
  ipcMain.handle('models', async () => {
    const { localModels, hardwareInfo, modelRecommendations } = await lmstudio();
    const models = await localModels();
    const hardware = hardwareInfo();
    return { models, hardware, recommendations: modelRecommendations(models, hardware) };
  });
  ipcMain.handle('cli-providers', async () => {
    const { cliStatus } = await cliProviders();
    return cliStatus();
  });

  ipcMain.handle('download-model', async (_event, modelKey) => {
    const { downloadModel } = await lmstudio();
    return downloadModel(modelKey);
  });
  ipcMain.handle('download-status', async (_event, jobId) => {
    const { downloadStatus } = await lmstudio();
    return downloadStatus(jobId);
  });

  ipcMain.handle('choose-folder', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: 'Choose a codebase to research' });
    if (!result.canceled && result.filePaths[0]) selectedFolder = result.filePaths[0];
    return selectedFolder;
  });
  ipcMain.handle('clear-folder', () => { selectedFolder = ''; return ''; });
  ipcMain.handle('open-source', (_event, location) => {
    if (typeof location !== 'string') return;
    if (/^https:\/\//i.test(location)) return shell.openExternal(location);
    if (selectedFolder && location.startsWith(selectedFolder + path.sep) && existsSync(location)) shell.showItemInFolder(location);
  });

  ipcMain.handle('draft-episode', async (_event, input) => {
    if (busy) throw new Error('Another episode is being processed.');
    if (!input || typeof input.notes !== 'string' || !input.notes.trim()) throw new Error('Add some notes before drafting.');
    if (input.notes.length > 200_000) throw new Error('Please use fewer than 200,000 characters.');
    if (typeof input.model !== 'string' || !input.model.trim()) throw new Error('Choose a writing model.');
    if (!['lmstudio', 'codex', 'claude'].includes(input.provider || 'lmstudio')) throw new Error('Choose a writing provider.');
    busy = true;
    const report = (message) => { if (window && !window.isDestroyed()) window.webContents.send('progress', { message }); };
    try {
      const sources = [];
      const warnings = [];
      const query = typeof input.query === 'string' && input.query.trim() ? input.query.trim() : input.notes.slice(0, 120);
      const { searchCodebase, searchWikipedia, readWebUrl } = await research();
      if (selectedFolder) {
        report('Searching the selected codebase…');
        sources.push(...await searchCodebase(selectedFolder, `${query} ${input.notes.slice(0, 300)}`));
      }
      if (input.wikipedia === true) {
        report('Searching Wikipedia…');
        try { sources.push(...await searchWikipedia(query)); }
        catch (error) { warnings.push(error.message); }
      }
      const urls = typeof input.urls === 'string' ? input.urls.split(/\s+/).filter(Boolean).slice(0, 4) : [];
      for (let i = 0; i < urls.length; i++) {
        report(`Reading web source ${i + 1} of ${urls.length}…`);
        try { sources.push(await readWebUrl(urls[i], i)); }
        catch (error) { warnings.push(error.message); }
      }
      report(input.provider === 'codex' ? 'Writing with Codex CLI…' : input.provider === 'claude' ? 'Writing with Claude CLI…' : 'Loading the LM Studio model and writing the two-host script…');
      const { writeEpisode } = await episode();
      const result = await writeEpisode({ provider: input.provider || 'lmstudio', model: input.model, effort: input.effort, notes: input.notes, sources });
      return { ...result, sources: sources.map(({ id, title, location, kind }) => ({ id, title, location, kind })), warnings };
    } finally { busy = false; }
  });

  ipcMain.handle('present', async (_event, input) => {
    if (busy) throw new Error('A presentation is already being generated.');
    if (!input || typeof input.markdown !== 'string' || !input.markdown.trim()) {
      throw new Error('Add some text or Markdown before presenting.');
    }
    if (input.markdown.length > 200_000) throw new Error('This document is too long. Please use fewer than 200,000 characters.');
    const voices = ['af_heart', 'af_bella', 'am_michael', 'bm_fable'];
    if (!voices.includes(input.voiceA) || !voices.includes(input.voiceB)) {
      throw new Error('Choose available voices for both hosts.');
    }
    if (input.segments && (!Array.isArray(input.segments) || input.segments.length > 80 || input.segments.some((part) => !['A', 'B'].includes(part.speaker) || typeof part.text !== 'string' || part.text.length > 3000))) throw new Error('The dialogue is too long or malformed.');
    const ffmpegPath = findFfmpeg();
    busy = true;
    const jobId = ++nextJob;
    const target = makeOutputPath(input.title || 'narration');
    const activeWorker = narratorWorker();
    try {
      await new Promise((resolve, reject) => {
        const onMessage = (message) => {
          if (message.jobId !== jobId) return;
          if (message.type === 'progress') {
            if (window && !window.isDestroyed()) window.webContents.send('progress', message);
          } else if (message.type === 'done') {
            cleanup(); resolve();
          } else if (message.type === 'error') {
            cleanup(); reject(new Error(message.error));
          }
        };
        const onError = (error) => { cleanup(); reject(error); };
        const onExit = (code) => { cleanup(); reject(new Error(`Narrator stopped unexpectedly (${code}).`)); };
        const cleanup = () => {
          activeWorker.off('message', onMessage);
          activeWorker.off('error', onError);
          activeWorker.off('exit', onExit);
        };
        activeWorker.on('message', onMessage);
        activeWorker.once('error', onError);
        activeWorker.once('exit', onExit);
        activeWorker.postMessage({ jobId, markdown: input.markdown, segments: input.segments || null, voiceA: input.voiceA, voiceB: input.voiceB, target, ffmpegPath });
      });
      return { path: target, url: pathToFileURL(target).href };
    } finally {
      busy = false;
    }
  });

  ipcMain.handle('show-output', (_event, filePath) => {
    if (typeof filePath !== 'string' || path.dirname(filePath) !== outputDir() || !filePath.endsWith('.mp3') || !existsSync(filePath)) return;
    shell.showItemInFolder(filePath);
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (worker) worker.terminate(); });
