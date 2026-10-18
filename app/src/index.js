
'use strict';

const http = require('node:http');

const PORT = Number(process.env.PORT) || 8080;

function createServer() {
  let isReady = true;

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
      });

      res.end(JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
      }));
      return;
    }

    if (req.url === '/ready') {
      if (!isReady) {
        res.writeHead(503, {
          'Content-Type': 'application/json',
        });

        res.end(JSON.stringify({
          status: 'not ready',
        }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
      });

      res.end(JSON.stringify({
        status: 'ready',
      }));
      return;
    }

    if (req.url === '/') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
      });

      res.end(JSON.stringify({
        message: 'Welcome to Rolloutary',
      }));
      return;
    }

    res.writeHead(404, {
      'Content-Type': 'application/json',
    });

    res.end(JSON.stringify({
      error: 'Not found',
    }));
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
