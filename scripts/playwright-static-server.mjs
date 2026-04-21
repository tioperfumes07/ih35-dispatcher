#!/usr/bin/env node
/**
 * Serves ./public over HTTP for Playwright layout tests (default 127.0.0.1:4777).
 * Not for production — path traversal is blocked to the public directory only.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PW_STATIC_PORT || 4777);
const HOST = process.env.PW_STATIC_HOST || '127.0.0.1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function fileForUrl(urlPath) {
  const raw = (urlPath || '/').split('?')[0];
  const rel = raw === '/' || raw === '' ? 'index.html' : raw.replace(/^\//, '');
  const resolved = path.resolve(root, path.join('.', rel));
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }
  const fp = fileForUrl(req.url);
  if (!fp) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    const ext = path.extname(fp);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(fp).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`playwright-static-server http://${HOST}:${PORT} → ${root}`);
});
