
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./index');

async function startTestServer() {
  const { server } = createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    }),
  };
}


test('GET / returns the Rolloutary dashboard HTML', async () => {
  const app = await startTestServer();

  try {
    const response = await fetch(`${app.baseUrl}/`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(body, /DevOps Control Center/);
    assert.match(body, /CI\/CD Pipeline/);
    assert.match(body, /Infrastructure Health/);
  } finally {
    await app.close();
  }
});


test('GET /health returns status and uptime', async () => {
  const app = await startTestServer();

  try {
    const response = await fetch(`${app.baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.uptime, 'number');
  } finally {
    await app.close();
  }
});

test('GET /ready reports that the app is ready', async () => {
  const app = await startTestServer();

  try {
    const response = await fetch(`${app.baseUrl}/ready`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ready');
  } finally {
    await app.close();
  }
});

test('unknown routes return HTTP 404', async () => {
  const app = await startTestServer();

  try {
    const response = await fetch(`${app.baseUrl}/does-not-exist`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error, 'Not found');
  } finally {
    await app.close();
  }
});
