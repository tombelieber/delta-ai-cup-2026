import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './index.mjs';
import { createMapAccess } from './map-access.mjs';
import { MapClassificationError, createMapClassificationService } from './map-classification.mjs';

const VIDEO = { videoId: 'abcdefghijk', title: 'Claude Code coding agent tutorial', channel: 'Example creator' };
const RESULT = { schemaVersion: 1, model: 'gemini-3.8-flash', cached: 0,
  items: [{ videoId: VIDEO.videoId, path: ['AI tools', 'Coding agents', 'Claude Code'], confidence: 'high', contentType: 'knowledge' }] };

async function setup(t, options = {}) {
  const encoded = Buffer.alloc(32, 19).toString('base64');
  const mapAccess = options.mapAccess || createMapAccess({ env: { LEARNING_SIGNING_KEY_BASE64: encoded } });
  const calls = [];
  const mapService = options.mapService || {
    readiness: () => ({ configured: true, model: 'gemini-3.8-flash', schemaVersion: 1 }),
    classify: async (input) => { calls.push(input); return structuredClone(RESULT); },
  };
  const server = createServer({
    service: { readiness: () => ({ configured: false }), recommend: async () => ({ status: 'no_history' }) },
    learningService: { readiness: () => ({ configured: false }) },
    mapService, mapAccess, ...options,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const endpoint = `${origin}/api/map/classify`;
  const token = mapAccess.ownerToken?.();
  const post = (body = { videos: [VIDEO] }, headers = {}) => fetch(endpoint, {
    method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json', 'x-delta-map-token': token || '', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { origin, endpoint, post, token, encoded, calls };
}

test('private map HTTP access rejects missing, malformed and wrong capabilities before invoking classification', async (t) => {
  const { endpoint, post, calls } = await setup(t);
  const missing = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videos: [VIDEO] }) });
  assert.equal(missing.status, 403);
  assert.equal((await missing.json()).error, 'map_access_required');
  for (const token of ['', 'bad', 'a'.repeat(43), 'a'.repeat(44)]) {
    const rejected = await post({ videos: [VIDEO] }, { 'x-delta-map-token': token });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls.length, 0);
});

test('unconfigured private access stays closed without a token, legacy key or public-origin bypass', async (t) => {
  const mapAccess = createMapAccess({ env: { LEARNING_SIGNING_KEY: 'test-only-legacy-key' } });
  const { origin, post, calls } = await setup(t, { mapAccess, allowChromeExtensions: true });
  for (const suppliedOrigin of [origin, `chrome-extension://${'a'.repeat(32)}`]) {
    assert.equal((await post({ videos: [VIDEO] }, { origin: suppliedOrigin, 'x-delta-map-token': 'a'.repeat(43) })).status, 403);
  }
  const health = await (await fetch(`${origin}/api/health`)).json();
  assert.equal(health.map.privateAccess, false);
  assert.equal(calls.length, 0);
});

test('valid owner access forwards metadata and returns English hierarchy JSON without exposing capabilities in health', async (t) => {
  const { origin, post, token, encoded, calls } = await setup(t);
  const input = { videos: [VIDEO], existingPaths: [['AI tools', 'Coding agents', 'Claude Code']] };
  const response = await post(input, { origin });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), RESULT);
  assert.deepEqual(calls, [input]);
  const healthResponse = await fetch(`${origin}/api/health`);
  const serialized = await healthResponse.text();
  const health = JSON.parse(serialized);
  assert.equal(health.version, '0.7.0');
  assert.equal(health.map.privateAccess, true);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(encoded), false);
  assert.equal(serialized.includes('ownerToken'), false);
  assert.equal(serialized.includes('GEMINI_API_KEY'), false);
  assert.equal(calls.length, 1);
});

test('foreign browser and extension origins are refused even with a valid capability; configured origins remain explicit', async (t) => {
  const extension = `chrome-extension://${'a'.repeat(32)}`;
  const otherExtension = `chrome-extension://${'b'.repeat(32)}`;
  const { post, calls } = await setup(t, { allowedOrigins: extension });
  for (const origin of ['https://unrelated.invalid', otherExtension, 'null']) {
    const response = await post({ videos: [VIDEO] }, { origin });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'origin_not_allowed');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  assert.equal(calls.length, 0);
  assert.equal((await post({ videos: [VIDEO] }, { origin: extension })).status, 200);
  assert.equal(calls.length, 1);
});

test('map HTTP enforces JSON content type and syntax before calling the classifier', async (t) => {
  const { endpoint, token, post, calls } = await setup(t);
  const missingType = await fetch(endpoint, { method: 'POST', headers: { 'x-delta-map-token': token }, body: new TextEncoder().encode('{}') });
  assert.equal(missingType.status, 415);
  assert.equal((await post({}, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('{')).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await post({ videos: [VIDEO] }, { 'content-type': 'Application/JSON; charset=utf-8' })).status, 200);
  assert.equal(calls.length, 1);
});

test('map request body is bounded at 512000 bytes independently of recommendation body limits', async (t) => {
  const { post, calls } = await setup(t, { maxBodyBytes: 1 });
  const envelope = JSON.stringify({ padding: '' });
  const maximum = JSON.stringify({ padding: 'x'.repeat(512000 - Buffer.byteLength(envelope)) });
  assert.equal(Buffer.byteLength(maximum), 512000);
  assert.equal((await post(maximum)).status, 200);
  assert.equal(calls.length, 1);
  const oversized = await post(maximum + ' ');
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, 'body_too_large');
  assert.equal(calls.length, 1);
});

test('typed quota and provider policy errors preserve safe codes and Retry-After without triggering another classification', async (t) => {
  for (const [code, status, cooldown] of [['free_tier_quota_exhausted', 429, 60], ['classification_busy', 429, 10], ['generation_disabled', 503], ['provider_billing_required', 503]]) {
    let calls = 0;
    const { post } = await setup(t, { mapService: { readiness: () => ({ configured: false, reason: code }),
      classify: async () => { calls++; throw new MapClassificationError(code, status, cooldown); } } });
    const response = await post();
    assert.equal(response.status, status);
    assert.equal(response.headers.get('retry-after'), cooldown ? String(cooldown) : null);
    assert.deepEqual(await response.json(), { error: code, message: code, ...(cooldown ? { retryAfterSeconds: cooldown } : {}) });
    assert.equal(calls, 1);
  }
});

test('unexpected classifier failures return a fixed unavailable response without leaking private provider errors', async (t) => {
  const { post } = await setup(t, { mapService: { readiness: () => ({ configured: true }),
    classify: async () => { throw Error('TEST_PRIVATE_PROVIDER_DETAILS_AND_KEY'); } } });
  const response = await post();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'map_unavailable');
  assert.equal(JSON.stringify(body).includes('TEST_PRIVATE'), false);
});

test('only POST can classify; unauthenticated preflight permits the capability header without exposing or using it', async (t) => {
  const { origin, endpoint, calls } = await setup(t);
  for (const method of ['GET', 'PUT', 'DELETE', 'HEAD']) {
    const response = await fetch(endpoint, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST, OPTIONS');
  }
  const response = await fetch(endpoint, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'Content-Type, X-Delta-Map-Token' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type, X-Delta-Map-Token');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.equal(calls.length, 0);
});

test('request rate limit applies after owner authorization and ignores spoofed forwarding headers', async (t) => {
  const { post, calls } = await setup(t, { requestsPerMinute: 1 });
  assert.equal((await post({}, { 'x-delta-map-token': 'invalid' })).status, 403);
  assert.equal((await post()).status, 200);
  const limited = await post(undefined, { 'x-forwarded-for': '8.8.8.8' });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await limited.json()).error, 'rate_limited');
  assert.equal(calls.length, 1);
});

test('HTTP wiring with the real classifier rejects personal fields before a model request', async (t) => {
  let modelRequests = 0;
  const mapService = createMapClassificationService({ env: { AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_FREE_TIER_ONLY: 'true',
    GEMINI_API_PROJECT: 'gen-lang-client-0441267635', GEMINI_API_KEY: 'test-only-not-a-secret',
    GEMINI_API_KEY_RESOURCE: 'projects/2937676390/locations/global/keys/c8631e91-1d44-4033-a5b6-1857223f4778' },
  fetchImpl: async () => { modelRequests++; throw Error('not permitted in this test'); } });
  const { post } = await setup(t, { mapService });
  const response = await post({ videos: [{ ...VIDEO, watchedAt: '2026-10-18' }], account: 'private' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_classification_input');
  assert.equal(modelRequests, 0);
});
