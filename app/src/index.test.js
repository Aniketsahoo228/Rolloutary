
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

function createStoredZip(filename, content) {
  const name = Buffer.from(filename);
  const body = Buffer.from(content);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(body.length, 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, body]);
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

test('GET /pipeline, /runs, and /logs return separate pages with shared navigation', async () => {
  const app = await startTestServer();
  const pages = [
    ['/pipeline', /Pipeline Studio/],
    ['/runs', /Run History/],
    ['/logs', /Logs &amp; Execution Details/],
  ];

  try {
    for (const [route, heading] of pages) {
      const response = await fetch(`${app.baseUrl}${route}`);
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.match(body, heading);
      assert.match(body, /href="\/pipeline"/);
      assert.match(body, /href="\/runs"/);
      assert.match(body, /href="\/logs"/);
      if (route === '/logs') {
        assert.match(body, /id="logs-run-select"/);
        assert.match(body, /id="logs-job-select"/);
        assert.match(body, /jobs\/\$\{encodeURIComponent\(jobId\)\}\/logs/);
        assert.match(body, /if \(!response\.ok\) throw new Error\(data\.error/);
        assert.match(body, /return data;/);
      }
    }
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

test('GET /api/github/actions/:runId/jobs returns real jobs and steps', async () => {
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'secret-token';

  const app = await startTestServer(async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/Aniketsahoo228/Rolloutary/actions/runs/42/jobs?per_page=100');
    assert.equal(options.headers.Authorization, 'Bearer secret-token');
    assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28');

    return {
      ok: true,
      json: async () => ({
        total_count: 3,
        jobs: [
          {
            id: 3,
            name: 'Deploy staging',
            status: 'completed',
            conclusion: 'success',
            started_at: '2024-01-01T02:00:00Z',
            completed_at: '2024-01-01T02:01:00Z',
            steps: [{
              number: 1,
              name: 'Verify rollout',
              status: 'completed',
              conclusion: 'success',
              started_at: '2024-01-01T02:00:00Z',
              completed_at: '2024-01-01T02:01:00Z',
            }],
          },
          {
            id: 1,
            name: 'Test application',
            status: 'completed',
            conclusion: 'success',
            started_at: '2024-01-01T00:00:00Z',
            completed_at: '2024-01-01T00:01:00Z',
            steps: [],
          },
          {
            id: 2,
            name: 'Build and publish Docker image',
            status: 'in_progress',
            conclusion: null,
            started_at: '2024-01-01T01:00:00Z',
            completed_at: null,
            steps: [],
          },
        ],
      }),
    };
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/github/actions/42/jobs`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.runId, 42);
    assert.deepEqual(body.jobs.map((job) => job.name), [
      'Test application',
      'Build and publish Docker image',
      'Deploy staging',
    ]);
    assert.equal(body.jobs[2].steps[0].name, 'Verify rollout');
    assert.equal(body.jobs[1].status, 'in_progress');
  } finally {
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await app.close();
  }
});

test('GET /api/github/actions/:runId/jobs/:jobId/logs validates the job and follows GitHub log redirects', async () => {
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'secret-token';
  const calls = [];
  const app = await startTestServer(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/actions/runs/42/jobs?per_page=100')) {
      return { ok: true, json: async () => ({ jobs: [{ id: 7 }] }) };
    }
    assert.equal(url, 'https://api.github.com/repos/Aniketsahoo228/Rolloutary/actions/jobs/7/logs');
    assert.equal(options.redirect, 'follow');
    assert.equal(options.headers.Authorization, 'Bearer secret-token');
    return {
      ok: true,
      headers: new Headers({ 'content-type': 'application/zip' }),
      arrayBuffer: async () => createStoredZip('test.txt', 'step output\n'),
    };
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/github/actions/42/jobs/7/logs`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/plain/);
    assert.equal(body, 'test.txt\nstep output\n');
    assert.equal(calls.length, 2);
  } finally {
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await app.close();
  }
});

test('GET job logs handles invalid IDs, expired logs, and missing authentication', async () => {
  const noToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  const app = await startTestServer();
  try {
    const invalidResponse = await fetch(`${app.baseUrl}/api/github/actions/nope/jobs/7/logs`);
    assert.equal(invalidResponse.status, 400);
    const invalidBody = await invalidResponse.json();
    assert.match(invalidBody.error, /Invalid/);

    const missingTokenResponse = await fetch(`${app.baseUrl}/api/github/actions/42/jobs/7/logs`);
    assert.equal(missingTokenResponse.status, 503);
  } finally {
    if (noToken !== undefined) process.env.GITHUB_TOKEN = noToken;
    await app.close();
  }

  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'secret-token';
  const expiredApp = await startTestServer(async (url) => {
    if (url.endsWith('/actions/runs/42/jobs?per_page=100')) {
      return { ok: true, json: async () => ({ jobs: [{ id: 7 }] }) };
    }
    return { ok: false, status: 410 };
  });
  try {
    const response = await fetch(`${expiredApp.baseUrl}/api/github/actions/42/jobs/7/logs`);
    const body = await response.json();
    assert.equal(response.status, 410);
    assert.match(body.error, /expired|unavailable/i);
  } finally {
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    await expiredApp.close();
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
