import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from './index.mjs';
import { createRecommendationService } from './recommend.mjs';
import { createGeminiProvider } from './gemini.mjs';

async function setup(t, extra = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'zhixin-http-test-'));
  const distDir = path.join(base, 'dist');
  await mkdir(path.join(distDir, 'assets'), { recursive: true });
  await writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>Test only</title>');
  await writeFile(path.join(distDir, 'assets', 'app.js'), 'export const testOnly = true;');
  await writeFile(path.join(base, '.env'), 'NEVER_SERVE_THIS');
  const service = createRecommendationService({ provider: createGeminiProvider({ env: {} }) });
  const server = createServer({ service, distDir, ...extra });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(base, { recursive: true, force: true }); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
const payload = JSON.stringify({ schemaVersion: 1, watched: [] });
const post = (url, extra = {}) => fetch(`${url}/api/recommendations`, { method: 'POST', headers: { 'content-type': 'application/json', ...extra.headers }, body: extra.body ?? payload });

test('HTTP health reports unavailable provider honestly and never exposes key material', async (t) => {
  const { url } = await setup(t);
  const response = await fetch(`${url}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.analysis.configured, false);
  assert.equal(body.analysis.reason, 'provider_not_configured');
  assert.equal(JSON.stringify(body).includes('apiKey'), false);
});
test('unconfigured deployed API returns unavailable instead of synthetic analysis', async (t) => {
  const { url } = await setup(t);
  const response = await post(url);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'unavailable');
  assert.equal(body.reason, 'provider_not_configured');
  assert.equal(body.recommendation, null);
  assert.deepEqual(body.memory, []);
});
test('same-origin public app can call API but unrelated web origins cannot', async (t) => {
  const { url } = await setup(t);
  const same = await post(url, { headers: { origin: url } });
  assert.equal(same.status, 200);
  assert.equal(same.headers.get('access-control-allow-origin'), url);
  const foreign = await post(url, { headers: { origin: 'https://unrelated.invalid' } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
});
test('Chrome extension origins require explicit exact configuration or an operator opt-in', async (t) => {
  const extension = `chrome-extension://${'a'.repeat(32)}`;
  const other = `chrome-extension://${'b'.repeat(32)}`;
  const { url } = await setup(t, { allowedOrigins: extension });
  assert.equal((await post(url, { headers: { origin: extension } })).status, 200);
  assert.equal((await post(url, { headers: { origin: other } })).status, 403);
  const optedIn = await setup(t, { allowChromeExtensions: true });
  assert.equal((await post(optedIn.url, { headers: { origin: other } })).status, 200);
  assert.equal((await post(optedIn.url, { headers: { origin: 'chrome-extension://not-an-id' } })).status, 403);
  assert.equal((await post(optedIn.url, { headers: { origin: 'https://unrelated.invalid' } })).status, 403);
});
test('CORS preflight is narrow and permits no credentials', async (t) => {
  const origin = 'https://team.invalid';
  const { url } = await setup(t, { allowedOrigins: origin });
  const response = await fetch(`${url}/api/recommendations`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'Content-Type' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type, X-Delta-Map-Token');
});
test('JSON API rejects malformed data, unsupported types and excess request bodies', async (t) => {
  const { url } = await setup(t, { maxBodyBytes: 100 });
  assert.equal((await post(url, { body: '{' })).status, 400);
  assert.equal((await post(url, { body: JSON.stringify({ schemaVersion: 1, watched: [], privateNotes: 'never allowed' }) })).status, 400);
  assert.equal((await post(url, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await post(url, { body: 'x'.repeat(101) })).status, 413);
  assert.equal((await fetch(`${url}/api/recommendations`)).status, 405);
  assert.equal((await fetch(`${url}/api/not-real`)).status, 404);
});
test('HTTP request limit ignores spoofed forwarding headers', async (t) => {
  const { url } = await setup(t, { requestsPerMinute: 1 });
  assert.equal((await post(url)).status, 200);
  const response = await post(url, { headers: { 'x-forwarded-for': '8.8.8.8' } });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
});
test('static server serves only dist, including /prototype, with safe MIME and headers', async (t) => {
  const { url } = await setup(t);
  for (const route of ['/', '/prototype', '/prototype/']) {
    const response = await fetch(`${url}${route}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Test only/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  const asset = await fetch(`${url}/assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /text\/javascript/);
  const head = await fetch(`${url}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const route of ['/.env', '/%2eenv', '/.git/config', '/server/index.mjs', '/src/data.js', '/assets/%2e%2e/%2e%2e/.env', '/%2e%2e%5c.env']) {
    const response = await fetch(`${url}${route}`);
    assert.equal(response.status, 404, route);
    assert.equal((await response.text()).includes('NEVER_SERVE_THIS'), false);
  }
});
