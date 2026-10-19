// Local server for the browser test, also handy to try the app: serves public/ like Vercel (cleanUrls, rewrites and
// headers from vercel.json, so the real CSP) and runs api/*.js on an in-memory Postgres (PGlite).
// `node test/server.mjs`, then log in with ADMIN_PASSWORD (default password-locale-123); data is gone when it stops.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fake = new URL('./fake-neon.mjs', import.meta.url).href;
registerHooks({ resolve: (s, c, next) => (s === '@neondatabase/serverless' ? { url: fake, shortCircuit: true } : next(s, c)) });
process.env.DATABASE_URL = 'pglite://memory';
process.env.ADMIN_PASSWORD ||= 'password-locale-123';

const root = fileURLToPath(new URL('..', import.meta.url));
const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const headers = vercel.headers.find((h) => h.source === '/(.*)').headers;
const rewrites = vercel.rewrites.map((r) => [new RegExp(`^${r.source.replace(/:\w+\(/g, '(')}/?$`), r.destination]);
const handlers = {};
for (const f of readdirSync(path.join(root, 'api')).filter((f) => !f.startsWith('_'))) {
  handlers[f.replace('.js', '')] = (await import(`../api/${f}`)).default;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

// Same request/response shape as Vercel's Node functions, as far as api/ uses it.
async function runApi(handler, req, res, url) {
  let raw = '';
  for await (const c of req) raw += c;
  try { req.body = raw ? JSON.parse(raw) : undefined; } catch { return res.writeHead(400).end('bad json'); }
  req.query = Object.fromEntries(url.searchParams);
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); };
  res.send = (b) => res.end(b);
  return handler(req, res);
}

export function start(port = 0) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const api = url.pathname.match(/^\/api\/(\w+)$/);
    if (api && handlers[api[1]]) return runApi(handlers[api[1]], req, res, url);
    let p = rewrites.find(([re]) => re.test(url.pathname))?.[1] || url.pathname;
    if (p.endsWith('/')) p += 'index.html';
    if (!path.extname(p)) p += '.html';
    try {
      const body = await readFile(path.join(root, 'public', p)); // URL parsing already removed any ".."
      for (const h of headers) res.setHeader(h.key, h.value);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await start(Number(process.env.PORT) || 5173);
  console.log(`Salone PRO on http://localhost:${server.address().port}`);
}
