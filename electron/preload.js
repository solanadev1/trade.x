const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', { action: (action) => {
  if (!['minimize', 'maximize', 'close', 'pin'].includes(action)) return Promise.reject(new Error('Invalid window action'));
  return ipcRenderer.invoke('window:action', action);
} });
