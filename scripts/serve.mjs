import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.md': 'text/plain' };

/**
 * Single range, null (ignore malformed/unsupported/multiple ranges), or false
 * (unsatisfiable). Inclusive offsets; BigInt avoids oversized numeral loss.
 */
export function parseByteRange(header, size) {
  if (typeof header !== 'string' || !Number.isSafeInteger(size) || size < 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const length = BigInt(size);
  if (!length) return false;
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (!suffix) return false;
    return { start: Number(suffix >= length ? 0n : length - suffix), end: size - 1 };
  }
  const start = BigInt(match[1]);
  const end = match[2] ? BigInt(match[2]) : length - 1n;
  if (match[2] && end < start) return null;
  if (start >= length) return false;
  return { start: Number(start), end: Number(end >= length ? length - 1n : end) };
}

function contained(root, path) {
  const local = relative(root, path);
  return local !== '' && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

/** Create without listening, so tests can use a temporary root and port. */
export function createStaticServer(rootDirectory = projectRoot) {
  const root = realpath(rootDirectory);
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Length': '0' });
        res.end();
        return;
      }
      // Decode before normalizing: encoded traversal must not become a public path.
      const pathname = decodeURIComponent((req.url || '/').split(/[?#]/, 1)[0]);
      if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') ||
          pathname.split('/').some(part => part.startsWith('.'))) throw new Error('Invalid path');
      const canonicalRoot = await root;
      const requested = resolve(canonicalRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!contained(canonicalRoot, requested)) throw new Error('Outside root');
      const path = await realpath(requested);
      if (!contained(canonicalRoot, path) || relative(canonicalRoot, path).split(sep).some(part => part.startsWith('.'))) throw new Error('Outside root');
      const info = await stat(path);
      if (!info.isFile() || !Number.isSafeInteger(info.size)) throw new Error('Not a file');
      const headers = {
        'Content-Type': types[extname(path).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(info.size)
      };
      // Range applies only to GET. No validators are offered; an If-Range
      // condition cannot be established as matching, so send the full file.
      const range = req.method === 'GET' && !req.headers['if-range'] ? parseByteRange(req.headers.range, info.size) : null;
      if (range === false) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}`, 'Content-Length': '0' });
        res.end();
        return;
      }
      if (range) {
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
        headers['Content-Length'] = String(range.end - range.start + 1);
      }
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD' || info.size === 0) res.end();
      else await pipeline(createReadStream(path, range || undefined), res);
    } catch {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      const body = 'Not found';
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Content-Length': String(Buffer.byteLength(body)) });
      res.end(req.method === 'HEAD' ? undefined : body);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const server = createStaticServer();
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. If El Reno is running, open http://localhost:${port}. Otherwise choose a different PORT.`);
    else console.error(`Could not start El Reno: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`El Reno is ready: ${url}\nPress Control+C to stop.`);
    if (process.argv.includes('--open') && process.platform === 'darwin') execFile('open', [url], () => {});
  });
}
