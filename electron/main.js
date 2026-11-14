const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, createWriteStream } = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { host, port, origin } = require('../scripts/local-server.cjs');
const appRoot = path.resolve(__dirname, '..');
const root = app.isPackaged ? path.join(process.resourcesPath, 'server') : appRoot;
const dataDir = process.env.CORTISOL_DATA_DIR || (app.isPackaged ? app.getPath('userData') : path.join(root, 'data'));
app.setName('Cortisol.x');
if (process.platform === 'win32') app.setAppUserModelId('com.cortisolx.desktop');
let win, server, quitting = false;
function portAvailable() { return new Promise((resolve, reject) => { const probe=net.createServer(); probe.once('error',()=>reject(new Error(`Cortisol port ${port} is already in use. Close the other Cortisol window. PumpStation on port 3000 can stay open.`))); probe.listen(port,host,()=>probe.close(resolve)); }); }
function ready() { return new Promise(resolve=>{const req=http.get(origin,res=>{res.resume();resolve(res.statusCode===200);});req.setTimeout(1000,()=>req.destroy());req.on('error',()=>resolve(false));}); }
async function startServer() {
  await portAvailable();
  const dev=process.argv.includes('--dev');
  if(!dev&&!existsSync(path.join(root,'.next','BUILD_ID')))throw new Error('Run First_Time_Setup.bat once to build the local application.');
  const portable=path.join(process.env.LOCALAPPDATA||'', 'Cortisol.x','node','node.exe');
  const node=app.isPackaged?path.join(process.resourcesPath,'runtime','node.exe'):process.platform==='win32'&&existsSync(portable)?portable:'node';
  mkdirSync(dataDir,{recursive:true});
  const log=createWriteStream(path.join(dataDir,'server.log'),{flags:'a'});
  const args=app.isPackaged?[path.join(root,'server.js')]:[require.resolve('next/dist/bin/next'),dev?'dev':'start','--hostname',host,'--port',String(port)];
  server=spawn(node,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:dev?'development':'production',CORTISOL_DATA_DIR:dataDir,HOSTNAME:host,PORT:String(port)}});
  server.stdout.pipe(log);server.stderr.pipe(log);
  let failure;
  server.on('error',error=>{failure=error;});
  server.on('exit',code=>{if(!quitting){failure=new Error(`Local server exited (${code}). See data/server.log.`);if(win){dialog.showErrorBox('Cortisol.x server stopped',failure.message);app.quit();}}});
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){if(failure)throw failure;if(await ready())return;await new Promise(resolve=>setTimeout(resolve,200));}
  throw new Error('Local server did not start within 60 seconds. See data/server.log.');
}
if(!app.requestSingleInstanceLock())app.quit();
else {
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
 app.whenReady().then(async()=>{
  try{
   await startServer();
   win=new BrowserWindow({width:1440,height:900,minWidth:1050,minHeight:700,title:'Cortisol.x',icon:path.join(appRoot,'assets',process.platform==='win32'?'app.ico':'app.png'),backgroundColor:'#0A0A0A',frame:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
   win.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith('https://'))void shell.openExternal(url);return {action:'deny'};});
   win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
   ipcMain.handle('window:action',(event,action)=>{if(event.sender!==win.webContents||new URL(event.senderFrame.url).origin!==origin)return;if(action==='minimize')win.minimize();if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();if(action==='close')win.close();if(action==='pin'){win.setAlwaysOnTop(!win.isAlwaysOnTop());return win.isAlwaysOnTop();}});
   await win.loadURL(origin);
  }catch(error){dialog.showErrorBox('Cortisol.x could not start',error.message);app.quit();}
 });
 app.on('before-quit',()=>{quitting=true;if(server&&server.pid&&server.exitCode===null){if(process.platform==='win32')spawn('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else server.kill('SIGTERM');}});
 app.on('window-all-closed',()=>app.quit());
}
