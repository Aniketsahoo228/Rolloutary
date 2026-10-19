'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PORT = Number(process.env.PORT) || 8080;
const dashboardPath = path.join(__dirname, 'dashboard.html');
const pagePaths = {
  '/pipeline': path.join(__dirname, 'pipeline.html'),
  '/runs': path.join(__dirname, 'runs.html'),
  '/logs': path.join(__dirname, 'logs.html'),
  '/pages.css': path.join(__dirname, 'pages.css'),
};

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Aniketsahoo228';
const GITHUB_REPO = process.env.GITHUB_REPO || 'Rolloutary';
const GITHUB_ACTIONS_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs?per_page=5`;
const GITHUB_ACTIONS_JOBS_URL = (runId) =>
  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}/jobs?per_page=100`;
const GITHUB_ACTIONS_JOB_LOGS_URL = (jobId) =>
  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/jobs/${jobId}/logs`;
const GITHUB_API_TIMEOUT_MS = 8000;
const MAX_LOG_ARCHIVE_BYTES = 20 * 1024 * 1024;
const WORKFLOW_JOB_ORDER = [
  'Test application',
  'Build and publish Docker image',
  'Deploy staging',
  'deploy-staging',
];

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
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

function buildGitHubJobsPayload(data, runId) {
  const jobs = (data.jobs || []).map((job) => ({
    id: job.id,
    name: job.name || 'GitHub Actions job',
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    steps: (job.steps || []).map((step, index) => ({
      number: step.number || index + 1,
      name: step.name || `Step ${index + 1}`,
      status: step.status,
      conclusion: step.conclusion,
      startedAt: step.started_at,
      completedAt: step.completed_at,
    })),
  }));

  jobs.sort((left, right) => {
    const leftIndex = WORKFLOW_JOB_ORDER.indexOf(left.name);
    const rightIndex = WORKFLOW_JOB_ORDER.indexOf(right.name);
    const normalizedLeft = leftIndex === -1 ? WORKFLOW_JOB_ORDER.length : leftIndex;
    const normalizedRight = rightIndex === -1 ? WORKFLOW_JOB_ORDER.length : rightIndex;
    return normalizedLeft - normalizedRight;
  });

  return {
    runId: Number(runId),
    fetchedAt: new Date().toISOString(),
    totalCount: data.total_count || jobs.length,
    jobs,
  };
}

function extractGitHubLogText(archive) {
  if (archive.length > MAX_LOG_ARCHIVE_BYTES) {
    throw new Error('GitHub log archive is too large');
  }

  const files = [];
  let offset = 0;

  while (offset + 30 <= archive.length) {
    const signature = archive.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;

    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);

    if (flags & 0x08) {
      throw new Error('GitHub log archive uses unsupported ZIP data descriptors');
    }

    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > archive.length) {
      throw new Error('GitHub log archive is truncated');
    }

    const name = archive.subarray(nameStart, dataStart - extraLength).toString('utf8');
    const compressed = archive.subarray(dataStart, dataEnd);
    let content;

    if (method === 0) {
      content = compressed;
    } else if (method === 8) {
      content = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported GitHub log compression method: ${method}`);
    }

    files.push(`${name}\n${content.toString('utf8')}`);
    offset = dataEnd;
  }

  if (!files.length) {
    throw new Error('GitHub log archive contained no log files');
  }

  return files.join('\n\n');
}

async function readGitHubLogResponse(response) {
  const contentType = response.headers && response.headers.get
    ? response.headers.get('content-type') || ''
    : '';

  if (contentType.includes('text/plain')) {
    return response.text();
  }

  const archive = Buffer.from(await response.arrayBuffer());
  return extractGitHubLogText(archive);
}

function getGitHubErrorResponse(statusCode, errorMessage) {
  return {
    statusCode,
    payload: {
      error: errorMessage,
    },
  };
}

function sendHtmlFile(res, filePath, contentType = 'text/html; charset=utf-8', unavailableMessage = 'Page unavailable') {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      return sendJson(res, 500, { error: unavailableMessage });
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
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

    const jobsMatch = url.pathname.match(/^\/api\/github\/actions\/(\d+)\/jobs$/);
    if (jobsMatch) {
      const token = process.env.GITHUB_TOKEN;

      if (!token) {
        return sendJson(res, 503, {
          error: 'GitHub integration is not configured',
        });
      }

      try {
        const response = await fetchImpl(GITHUB_ACTIONS_JOBS_URL(jobsMatch[1]), {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
        });

        if (!response.ok) {
          console.error('GitHub Actions jobs API returned:', response.status);

          const errorResponse = response.status === 403 || response.status === 401
            ? getGitHubErrorResponse(502, 'GitHub access denied. Check token permissions and rate limits.')
            : response.status === 404
              ? getGitHubErrorResponse(404, 'Workflow run or jobs resource not found.')
              : getGitHubErrorResponse(502, 'Unable to retrieve GitHub job status.');

          return sendJson(res, errorResponse.statusCode, errorResponse.payload);
        }

        const data = await response.json();
        return sendJson(res, 200, buildGitHubJobsPayload(data, jobsMatch[1]));
      } catch (error) {
        console.error('GitHub Actions jobs request failed:', error.name);

        return sendJson(res, 502, {
          error: error.name === 'TimeoutError'
            ? 'GitHub jobs request timed out. Try again shortly.'
            : 'Unable to connect to GitHub job status.',
        });
      }
    }

    const logsMatch = url.pathname.match(/^\/api\/github\/actions\/([^/]+)\/jobs\/([^/]+)\/logs$/);
    if (logsMatch) {
      const runId = Number(logsMatch[1]);
      const jobId = Number(logsMatch[2]);

      if (!Number.isSafeInteger(runId) || runId <= 0 || !Number.isSafeInteger(jobId) || jobId <= 0) {
        return sendJson(res, 400, { error: 'Invalid workflow run or job ID' });
      }

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return sendJson(res, 503, {
          error: 'GitHub integration is not configured',
        });
      }

      const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      };

      try {
        const jobsResponse = await fetchImpl(GITHUB_ACTIONS_JOBS_URL(runId), {
          headers,
          signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
        });

        if (!jobsResponse.ok) {
          const errorResponse = jobsResponse.status === 403 || jobsResponse.status === 401
            ? getGitHubErrorResponse(502, 'GitHub access denied. Check token permissions and rate limits.')
            : jobsResponse.status === 404
              ? getGitHubErrorResponse(404, 'Workflow run or jobs resource not found.')
              : getGitHubErrorResponse(502, 'Unable to retrieve GitHub job status.');

          return sendJson(res, errorResponse.statusCode, errorResponse.payload);
        }

        const jobsData = await jobsResponse.json();
        const jobExists = (jobsData.jobs || []).some((job) => Number(job.id) === jobId);
        if (!jobExists) {
          return sendJson(res, 404, { error: 'Job not found for the selected workflow run.' });
        }

        const response = await fetchImpl(GITHUB_ACTIONS_JOB_LOGS_URL(jobId), {
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
        });

        if (!response.ok) {
          console.error('GitHub Actions job logs API returned:', response.status);

          const errorResponse = response.status === 401 || response.status === 403
            ? getGitHubErrorResponse(502, 'GitHub denied access to these job logs. Check token permissions and rate limits.')
            : response.status === 404
              ? getGitHubErrorResponse(404, 'Workflow job or log resource not found.')
              : response.status === 410
                ? getGitHubErrorResponse(410, 'GitHub job logs have expired or are unavailable.')
                : getGitHubErrorResponse(502, 'Unable to retrieve GitHub job logs.');

          return sendJson(res, errorResponse.statusCode, errorResponse.payload);
        }

        const logs = await readGitHubLogResponse(response);
        return sendText(res, 200, logs);
      } catch (error) {
        console.error('GitHub Actions job logs request failed:', error.name);

        return sendJson(res, 502, {
          error: error.name === 'TimeoutError'
            ? 'GitHub job logs request timed out. Try again shortly.'
            : error.message.startsWith('GitHub log archive') || error.message.startsWith('Unsupported GitHub log')
              ? 'GitHub returned an unreadable job log archive.'
              : 'Unable to connect to GitHub job logs.',
        });
      }
    }

    if (url.pathname === '/') {
      return sendHtmlFile(res, dashboardPath, 'text/html; charset=utf-8', 'Dashboard unavailable');
    }

    if (pagePaths[url.pathname]) {
      const contentType = url.pathname === '/pages.css'
        ? 'text/css; charset=utf-8'
        : 'text/html; charset=utf-8';
      return sendHtmlFile(res, pagePaths[url.pathname], contentType);
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
