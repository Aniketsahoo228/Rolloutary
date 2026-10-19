
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./index');

async function startTestServer(fetchImpl) {
  const { server } = createServer({ fetchImpl });

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

test('GET /api/github/actions returns a configured error without a token', async () => {
  const originalToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  const app = await startTestServer();

  try {
    const response = await fetch(`${app.baseUrl}/api/github/actions`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error, 'GitHub integration is not configured');
  } finally {
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await app.close();
  }
});

test('GET /api/github/actions calls GitHub and normalizes workflow runs', async () => {
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'secret-token';

  const app = await startTestServer(async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/Aniketsahoo228/Rolloutary/actions/runs?per_page=5');
    assert.equal(options.headers.Authorization, 'Bearer secret-token');
    assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.ok(options.signal);

    return {
      ok: true,
      json: async () => ({
        total_count: 1,
        workflow_runs: [{
          id: 42,
          name: 'CI',
          display_title: 'CI',
          status: 'completed',
          conclusion: 'success',
          head_branch: 'main',
          head_sha: 'abcdef1234567890',
          event: 'push',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T01:00:00Z',
          html_url: 'https://github.com/Aniketsahoo228/Rolloutary/actions/runs/42',
        }],
      }),
    };
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/github/actions`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.repository, 'Aniketsahoo228/Rolloutary');
    assert.equal(body.totalCount, 1);
    assert.equal(body.latest.name, 'CI');
    assert.equal(body.latest.shortCommit, 'abcdef1');
    assert.equal(body.latest.url, 'https://github.com/Aniketsahoo228/Rolloutary/actions/runs/42');
  } finally {
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await app.close();
  }
});

test('GET /api/github/actions handles GitHub API failures and timeouts safely', async () => {
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'secret-token';

  const forbiddenApp = await startTestServer(async () => ({
    ok: false,
    status: 403,
  }));

  try {
    const forbiddenResponse = await fetch(`${forbiddenApp.baseUrl}/api/github/actions`);
    const forbiddenBody = await forbiddenResponse.json();

    assert.equal(forbiddenResponse.status, 502);
    assert.match(forbiddenBody.error, /GitHub access denied/);
  } finally {
    await forbiddenApp.close();
  }

  const timeoutError = new Error('The operation was aborted');
  timeoutError.name = 'TimeoutError';

  const timeoutApp = await startTestServer(async () => {
    throw timeoutError;
  });

  try {
    const timeoutResponse = await fetch(`${timeoutApp.baseUrl}/api/github/actions`);
    const timeoutBody = await timeoutResponse.json();

    assert.equal(timeoutResponse.status, 502);
    assert.match(timeoutBody.error, /timed out|Unable to connect/i);
  } finally {
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await timeoutApp.close();
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
