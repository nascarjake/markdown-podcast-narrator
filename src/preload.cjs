const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('narrator', {
  present: (input) => ipcRenderer.invoke('present', input),
  models: () => ipcRenderer.invoke('models'),
  cliProviders: () => ipcRenderer.invoke('cli-providers'),
  downloadModel: (modelKey) => ipcRenderer.invoke('download-model', modelKey),
  downloadStatus: (jobId) => ipcRenderer.invoke('download-status', jobId),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  clearFolder: () => ipcRenderer.invoke('clear-folder'),
  draftEpisode: (input) => ipcRenderer.invoke('draft-episode', input),
  openSource: (location) => ipcRenderer.invoke('open-source', location),
  showOutput: (filePath) => ipcRenderer.invoke('show-output', filePath),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('progress', listener);
    return () => ipcRenderer.removeListener('progress', listener);
  }
});
