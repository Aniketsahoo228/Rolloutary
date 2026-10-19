
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 8080;
const dashboardPath = path.join(__dirname, 'dashboard.html');

function createServer() {
  let isReady = true;

  const server = http.createServer((req, res) => {
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
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });

      res.end(JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
      }));
      return;
    }

    if (url.pathname === '/ready') {
      if (!isReady) {
        res.writeHead(503, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });

        res.end(JSON.stringify({ status: 'not ready' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });

      res.end(JSON.stringify({ status: 'ready' }));
      return;
    }

    if (url.pathname === '/') {
      fs.readFile(dashboardPath, (error, html) => {
        if (error) {
          res.writeHead(500, {
            'Content-Type': 'application/json',
          });
          res.end(JSON.stringify({ error: 'Dashboard unavailable' }));
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(html);
      });
      return;
    }

    res.writeHead(404, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify({ error: 'Not found' }));
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
