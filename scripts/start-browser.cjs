const { spawn } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { host, port, origin: url } = require('./local-server.cjs');
const root = path.resolve(__dirname, '..');

function ensurePortFree() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error('Cortisol port 4317 is already in use. Close the other Cortisol.x instance and try again; PumpStation can stay open.')));
    probe.listen(port, host, () => probe.close(resolve));
  });
}
function ready() {
  return new Promise(resolve => {
    const req = http.get(url, res => { res.resume(); resolve(res.statusCode === 200); });
    req.setTimeout(1000, () => req.destroy());
    req.on('error', () => resolve(false));
  });
}
async function main() {
  await ensurePortFree();
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', host, '--port', String(port)], { cwd: root, stdio: 'inherit' });
  let stopped = false;
  const stop = () => { if (!stopped) { stopped = true; server.kill('SIGTERM'); } };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  server.on('error', error => { console.error(error.message); process.exitCode = 1; stopped = true; });
  server.on('exit', code => { stopped = true; process.exitCode = code ?? 0; });
  const deadline = Date.now() + 60000;
  while (!stopped && Date.now() < deadline) {
    if (await ready()) {
      console.log(`\nCortisol.x is running locally at ${url}`);
      console.log('Keep this window open. Press Ctrl+C here to stop the app and its position monitor.');
      if (process.env.CORTISOL_NO_OPEN !== '1') {
        const executable = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        const browser = spawn(executable, [url], { stdio: 'ignore' });
        browser.on('error', () => console.log(`Open ${url} in your browser.`));
        browser.unref();
      }
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!stopped) { console.error('The local server did not become ready within 60 seconds.'); stop(); process.exitCode = 1; }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
