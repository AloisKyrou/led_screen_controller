'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('../test-support/server');

test('login limits failed attempts per peer IP, ignores spoofed headers and excludes successful logins', { timeout: 30000 }, async () => {
  const server = await startServer();
  function request(route, password, address = '127.0.0.1', forwarded) {
    return new Promise((resolve, reject) => {
      const body = password === undefined ? '' : new URLSearchParams({ username: 'admin', password }).toString();
      const req = http.request(server.url + route, {
        method: password === undefined ? 'GET' : 'POST', localAddress: address,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded',
          ...(forwarded ? { 'X-Forwarded-For': forwarded } : {}) },
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
      });
      req.on('error', reject); req.end(body);
    });
  }
  try {
    for (let i = 0; i < 7; i++) {
      assert.equal((await request('/admin/login', 'test-password')).headers.location, '/admin/');
    }
    for (let i = 0; i < 4; i++) await request('/admin/login', 'wrong');
    assert.equal(JSON.parse((await request('/admin/login/status')).data).blocked, false);
    // A successful login resets previous failures for this IP.
    assert.equal((await request('/admin/login', 'test-password')).headers.location, '/admin/');
    for (let i = 0; i < 5; i++) await request('/admin/login', 'wrong');
    const status = JSON.parse((await request('/admin/login/status')).data);
    assert.equal(status.blocked, true);
    assert.ok(status.retryAfterSeconds > 0 && status.retryAfterSeconds <= 300);
    const blocked = await request('/admin/login', 'test-password', '127.0.0.1', '203.0.113.123');
    assert.equal(blocked.headers.location, '/admin/login?error=rate');
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    // An actual different source IP has a separate counter, even for the same account.
    assert.equal(JSON.parse((await request('/admin/login/status', undefined, '127.0.0.2')).data).blocked, false);
    assert.equal((await request('/admin/login', 'test-password', '127.0.0.2')).headers.location, '/admin/');
    assert.equal(JSON.parse((await request('/admin/login/status')).data).blocked, true);
  } finally { await server.stop(); }
});
