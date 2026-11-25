'use strict';
/* Local adapter for the Vercel handler (development only). */
const http = require('node:http');
const handler = require('./api/index');

const PORT = Number(process.env.PORT || 4020);
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (raw) { try { req.body = JSON.parse(raw); } catch {} }
    handler(req, res).catch((e) => {
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    });
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`local api on http://127.0.0.1:${PORT}`));
