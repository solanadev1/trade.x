const fs = require('node:fs');
const path = require('node:path');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the Windows installer on Windows x64, using npm run dist:win.');
const root = path.resolve(__dirname, '..');
for (const file of ['.next/standalone/server.js', '.next/standalone/.next/BUILD_ID', 'assets/app.ico']) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}; build the app first.`);
}
const staging = path.join(root, 'work', 'packaging');
fs.mkdirSync(staging, { recursive: true });
fs.copyFileSync(process.execPath, path.join(staging, 'node.exe'));
// User databases and local environment files never belong in an installer.
const server = path.join(root, '.next', 'standalone');
fs.rmSync(path.join(server, 'data'), { recursive: true, force: true });
for (const name of fs.readdirSync(server)) if (name.startsWith('.env')) fs.rmSync(path.join(server, name), { force: true });
console.log('Prepared standalone server and matching Node runtime for Windows installer.');
