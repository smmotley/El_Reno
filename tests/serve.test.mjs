import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer, parseByteRange } from '../scripts/serve.mjs';

test('range parser supports bounded, open, suffix and oversized integers without precision loss', () => {
  assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange('bytes=8-', 10), { start: 8, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-999999999999999999999999', 10), { start: 0, end: 9 });
  assert.deepEqual(parseByteRange('bytes=0-999999999999999999999999', 10), { start: 0, end: 9 });
  for (const value of ['bytes=10-', 'bytes=20-30', 'bytes=-0', 'bytes=999999999999999999999999-']) assert.equal(parseByteRange(value, 10), false);
  for (const value of ['bytes=2-1', 'bytes=-', 'bytes=a-b', 'bytes=0-1,4-5', 'items=0-1']) assert.equal(parseByteRange(value, 10), null);
  assert.equal(parseByteRange('bytes=0-0', 0), false);
});

test('local media server streams safe files and implements byte-range HTTP semantics', async t => {
  const base = await mkdtemp(join(tmpdir(), 'el-reno-server-'));
  const root = join(base, 'public');
  await mkdir(root);
  const data = Buffer.from('0123456789abcdef');
  await Promise.all([
    writeFile(join(root, 'my clip.MOV'), data), writeFile(join(root, 'clip.mp4'), data),
    writeFile(join(root, 'volume.bin.gz'), Buffer.from([0x1f, 0x8b, 0x08, 0, 0xff, 0x00])),
    writeFile(join(root, 'index.html'), '<p>Index</p>'), writeFile(join(root, '.secret'), 'hidden'),
    writeFile(join(base, 'outside.txt'), 'outside'), writeFile(join(root, 'empty.mp4'), '')
  ]);
  await symlink(join(base, 'outside.txt'), join(root, 'outside-link'));
  await symlink(join(root, '.secret'), join(root, 'hidden-link'));
  const server = createStaticServer(root);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(base, { recursive: true, force: true }); });
  const request = (path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });

  await t.test('encoded spaces and MOV/MP4 MIME types return exact bytes with Content-Length', async () => {
    const mov = await request('/my%20clip.MOV?cache=1');
    assert.equal(mov.status, 200);
    assert.equal(mov.headers['content-type'], 'video/quicktime');
    assert.equal(mov.headers['content-length'], String(data.length));
    assert.equal(mov.headers['accept-ranges'], 'bytes');
    assert.deepEqual(mov.body, data);
    assert.equal((await request('/clip.mp4')).headers['content-type'], 'video/mp4');
    assert.equal((await request('/')).body.toString(), '<p>Index</p>');
  });
  await t.test('partial requests stream bounded, open-ended, suffix and clamped bytes', async () => {
    for (const [range, start, end] of [['bytes=2-5', 2, 5], ['bytes=13-', 13, 15], ['bytes=-4', 12, 15], ['bytes=12-999', 12, 15], ['bytes=0-0', 0, 0]]) {
      const response = await request('/clip.mp4', { headers: { Range: range } });
      assert.equal(response.status, 206);
      assert.equal(response.headers['content-range'], `bytes ${start}-${end}/${data.length}`);
      assert.equal(response.headers['content-length'], String(end - start + 1));
      assert.deepEqual(response.body, data.subarray(start, end + 1));
    }
  });
  await t.test('unsatisfiable requests return 416 and full representation size', async () => {
    for (const [path, range, size] of [['/clip.mp4', 'bytes=16-', 16], ['/clip.mp4', 'bytes=-0', 16], ['/empty.mp4', 'bytes=0-0', 0]]) {
      const response = await request(path, { headers: { Range: range } });
      assert.equal(response.status, 416);
      assert.equal(response.headers['content-range'], `bytes */${size}`);
      assert.equal(response.body.length, 0);
    }
  });
  await t.test('HEAD ignores Range and has metadata without a body', async () => {
    const response = await request('/my%20clip.MOV', { method: 'HEAD', headers: { Range: 'bytes=2-5' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-length'], '16');
    assert.equal(response.headers['content-range'], undefined);
    assert.equal(response.body.length, 0);
    assert.equal((await request('/missing', { method: 'HEAD' })).body.length, 0);
  });
  await t.test('unsupported ranges and unverifiable If-Range conditions safely return full content', async () => {
    for (const headers of [{ Range: 'bytes=0-1,4-5' }, { Range: 'items=2-5' }, { Range: 'bytes=2-1' }, { Range: 'bytes=1-2', 'If-Range': '"old-version"' }]) {
      const response = await request('/clip.mp4', { headers });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, data);
    }
  });
  await t.test('gzip data stays raw and zero-byte files do not produce invalid stream ranges', async () => {
    const gzip = await request('/volume.bin.gz');
    assert.equal(gzip.headers['content-encoding'], undefined);
    assert.deepEqual(gzip.body, Buffer.from([0x1f, 0x8b, 0x08, 0, 0xff, 0x00]));
    const empty = await request('/empty.mp4');
    assert.equal(empty.status, 200);
    assert.equal(empty.headers['content-length'], '0');
  });
  await t.test('traversal, hidden names, malformed escapes and escaping symlinks remain inaccessible', async () => {
    for (const path of ['/../outside.txt', '/%2e%2e/outside.txt', '/dir/%2e%2e/clip.mp4', '/%2esecret', '/.secret', '/outside-link', '/hidden-link', '/%00', '/%ZZ', '/foo%5c..%5coutside.txt']) {
      assert.equal((await request(path)).status, 404, path);
    }
    assert.equal((await request('/clip.mp4', { method: 'POST' })).status, 405);
  });
});
