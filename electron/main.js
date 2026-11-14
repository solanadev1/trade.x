const { app, BrowserWindow, ipcMain, shell } = require('electron');
let win;
const origin = 'http://127.0.0.1:3000';
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    win = new BrowserWindow({ width: 1440, height: 900, minWidth: 1050, minHeight: 700, backgroundColor: '#090A0F', frame: false, autoHideMenuBar: true,
      webPreferences: { preload: require('path').join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
    ipcMain.handle('window:action', (event, action) => {
      if (event.sender !== win.webContents || new URL(event.senderFrame.url).origin !== origin) return;
      if (action === 'minimize') win.minimize();
      if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
      if (action === 'close') win.close();
      if (action === 'pin') { win.setAlwaysOnTop(!win.isAlwaysOnTop()); return win.isAlwaysOnTop(); }
    });
    win.loadURL(origin);
  });
  // concurrently --kill-others terminates the server process tree when Electron exits.
  app.on('window-all-closed', () => app.quit());
}
