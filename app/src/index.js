'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 8080;
const dashboardPath = path.join(__dirname, 'dashboard.html');

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Aniketsahoo228';
const GITHUB_REPO = process.env.GITHUB_REPO || 'Rolloutary';
const GITHUB_ACTIONS_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs?per_page=5`;
const GITHUB_API_TIMEOUT_MS = 8000;

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function buildGitHubRunsPayload(data) {
  const runs = (data.workflow_runs || []).map((run) => ({
    id: run.id,
    name: run.name || run.display_title || 'GitHub Actions',
    workflowName: run.name || 'Workflow',
    status: run.status,
    conclusion: run.conclusion,
    branch: run.head_branch,
    commit: run.head_sha,
    shortCommit: run.head_sha ? run.head_sha.slice(0, 7) : null,
    event: run.event,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    url: run.html_url,
  }));

  return {
    repository: `${GITHUB_OWNER}/${GITHUB_REPO}`,
    fetchedAt: new Date().toISOString(),
    totalCount: data.total_count || 0,
    latest: runs[0] || null,
    runs,
  };
}

function getGitHubErrorResponse(statusCode, errorMessage) {
  return {
    statusCode,
    payload: {
      error: errorMessage,
    },
  };
}

function createServer({ fetchImpl = globalThis.fetch } = {}) {
  let isReady = true;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method !== 'GET') {
      res.writeHead(405, {
        'Content-Type': 'application/json',
        'Allow': 'GET',
      });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    if (url.pathname === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        uptime: process.uptime(),
      });
    }

    if (url.pathname === '/ready') {
      return sendJson(res, isReady ? 200 : 503, {
        status: isReady ? 'ready' : 'not ready',
      });
    }

    if (url.pathname === '/api/github/actions') {
      const token = process.env.GITHUB_TOKEN;

      if (!token) {
        return sendJson(res, 503, {
          error: 'GitHub integration is not configured',
        });
      }

      try {
        const response = await fetchImpl(GITHUB_ACTIONS_API_URL, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
        });

        if (!response.ok) {
          console.error('GitHub Actions API returned:', response.status);

          const errorResponse = response.status === 403 || response.status === 401
            ? getGitHubErrorResponse(502, 'GitHub access denied. Check token permissions and rate limits.')
            : response.status === 404
              ? getGitHubErrorResponse(404, 'Repository or Actions resource not found.')
              : getGitHubErrorResponse(502, 'Unable to retrieve GitHub Actions status.');

          return sendJson(res, errorResponse.statusCode, errorResponse.payload);
        }

        const data = await response.json();
        return sendJson(res, 200, buildGitHubRunsPayload(data));
      } catch (error) {
        console.error('GitHub Actions request failed:', error.name);

        return sendJson(res, 502, {
          error: error.name === 'TimeoutError'
            ? 'GitHub request timed out. Try again shortly.'
            : 'Unable to connect to GitHub Actions.',
        });
      }
    }

    if (url.pathname === '/') {
      fs.readFile(dashboardPath, (error, html) => {
        if (error) {
          return sendJson(res, 500, {
            error: 'Dashboard unavailable',
          });
        }

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(html);
      });
      return;
    }

    return sendJson(res, 404, { error: 'Not found' });
  });

  return {
    server,
    beginShutdown() {
      isReady = false;
    },
  };
}

if (require.main === module) {
  const { server, beginShutdown } = createServer();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Rolloutary server running on port ${PORT}`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received; starting graceful shutdown');
    beginShutdown();

    const forceShutdown = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 10000);

    forceShutdown.unref();

    server.close(() => {
      clearTimeout(forceShutdown);
      console.log('Rolloutary server closed');
      process.exit(0);
    });
  });
}

module.exports = { createServer };
