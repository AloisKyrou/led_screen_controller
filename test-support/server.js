'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { once } = require('events');

// Exercise the real server, isolated from project data and the physical panel.
async function startServer(existingDirectory) {
  const directory = existingDirectory || fs.mkdtempSync(path.join(os.tmpdir(), 'nools-gif-server-'));
  if (!existingDirectory) {
    const source = path.join(__dirname, '..');
    for (const name of ['server.js', 'lib', 'effects', 'public']) {
      fs.cpSync(path.join(source, name), path.join(directory, name), { recursive: true });
    }
    fs.writeFileSync(path.join(directory, 'effects.json'), JSON.stringify({ public_messages: { enabled: false, duration: 1 } }));
  }
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [path.join(directory, 'server.js')], {
    cwd: directory, windowsHide: true,
    env: { ...process.env, PORT: String(port), ARTNET_TARGET_IP: '127.0.0.1',
      ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'test-secret',
      PUBLIC_COOLDOWN_SECONDS: '0.001', PUBLIC_RATE_LIMIT: '100', PUBLIC_GLOBAL_RATE_LIMIT: '1000',
      NODE_PATH: process.env.NODE_PATH || path.join(__dirname, '..', 'node_modules') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Server startup timed out: ${output}`)); }, 15000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('Panel Controller running')) { clearTimeout(timer); resolve(); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${output}`)); });
  });
  const url = `http://127.0.0.1:${port}`;
  let cookie = '';
  return {
    url, directory,
    async login() {
      const result = await fetch(url + '/admin/login', { method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=admin&password=test-password' });
      cookie = (result.headers.get('set-cookie') || '').split(';')[0];
      if (!cookie) throw new Error('Test login failed');
      return cookie;
    },
    request(route, body, admin = false) {
      return fetch(url + route, { method: body === undefined ? 'GET' : 'POST',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(admin ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
    },
    async stop(remove = true) {
      if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
      if (remove) {
        const resolved = path.resolve(directory), prefix = path.resolve(os.tmpdir()) + path.sep + 'nools-gif-server-';
        if (!resolved.startsWith(prefix)) throw new Error('Refusing to remove an unexpected test directory');
        fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
      }
    },
  };
}

module.exports = { startServer };
