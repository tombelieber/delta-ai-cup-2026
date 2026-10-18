import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapAnalysisClient, MapAnalysisError, normalizeMapEndpoint, validateMapAnalysisResponse } from './map-analysis-client.js';
import { mapMetadataFingerprint } from './map-model.js';

const endpoint = 'https://map.example.com';
const video = { videoId: 'abcdefghijk', title: 'Claude Code tips', channel: 'Example creator' };
const result = () => ({ schemaVersion: 1, model: 'approved-free-model', cached: 0,
  items: [{ videoId: video.videoId, path: ['AI tools', 'Coding agents', 'Claude Code'], confidence: 'high', contentType: 'knowledge' }] });
const response = value => ({ ok: true, text: async () => JSON.stringify(value) });
const publicEndpoint = 'https://delta-assistant-613646062582.us-central1.run.app';

test('public classification verifies Google configuration and sends only selected metadata through the hosted action', async () => {
  const calls = [];
  const client = createMapAnalysisClient({ fetchImpl: async (url, options) => {
    calls.push({ url, options }); return response({ enabled: true });
  }, openHostedAction: async options => { calls.push(options); return result(); } });
  const value = await client.classify(publicEndpoint, { videos: [{ ...video, notes: 'private', date: '2026-10-19' }], existingPaths: [['AI tools']] }, { accessToken: 'private_owner_capability_1234567890' });
  assert.equal(calls[0].url, `${publicEndpoint}/api/study/auth-config`);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].action, 'classify');
  assert.equal(calls[1].endpoint, publicEndpoint);
  assert.deepEqual(calls[1].payload, { videos: [video], existingPaths: [['AI tools']] });
  assert.equal(JSON.stringify(calls).includes('private_owner'), false);
  assert.equal(JSON.stringify(calls[1]).includes('private'), false);
  assert.equal(value.items[0].metadataFingerprint, mapMetadataFingerprint(video));
});

test('public configuration errors, invalid bridge results and oversized batches never fall back to the legacy route', async () => {
  for (const config of [{ enabled: false }, {}, { enabled: 'true' }]) {
    let hosted = 0;
    const urls = [];
    const client = createMapAnalysisClient({ fetchImpl: async url => { urls.push(url); return response(config); }, openHostedAction: async () => { hosted++; return result(); } });
    await assert.rejects(client.classify(publicEndpoint, { videos: [video] }), issue => issue.code === 'AUTH_UNAVAILABLE');
    assert.equal(hosted, 0); assert.deepEqual(urls, [`${publicEndpoint}/api/study/auth-config`]);
  }
  let hosted = 0, fetches = 0;
  const client = createMapAnalysisClient({ fetchImpl: async () => { fetches++; return response({ enabled: true }); }, openHostedAction: async () => { hosted++; return { ...result(), items: [{ ...result().items[0], videoId: '12345678901' }] }; } });
  await assert.rejects(client.classify(publicEndpoint, { videos: [video] }), issue => issue.code === 'INVALID_RESPONSE');
  const videos = Array.from({ length: 13 }, (_, n) => ({ videoId: `v${String(n).padStart(10, '0')}`, title: 'Actual source title' }));
  await assert.rejects(client.classify(publicEndpoint, { videos }), issue => issue.code === 'INVALID_REQUEST');
  assert.equal(hosted, 1); assert.equal(fetches, 1);
});

test('cancelled hosted work cannot return a late success and quota errors stay safe and typed', async () => {
  const abort = new AbortController();
  const client = createMapAnalysisClient({ fetchImpl: async () => response({ enabled: true }), openHostedAction: async () => { abort.abort(); return result(); } });
  await assert.rejects(client.classify(publicEndpoint, { videos: [video] }, { signal: abort.signal }), issue => issue.code === 'CANCELLED');
  const quota = createMapAnalysisClient({ fetchImpl: async () => response({ enabled: true }), openHostedAction: async () => { throw Object.assign(Error('Private provider detail'), { code: 'USER_QUOTA', status: 429 }); } });
  await assert.rejects(quota.classify(publicEndpoint, { videos: [video] }), issue => issue.code === 'USER_QUOTA' && issue.status === 429 && !issue.message.includes('Private'));
  const failed = createMapAnalysisClient({ fetchImpl: async () => response({ enabled: true }), openHostedAction: async () => { throw Error('Private provider detail'); } });
  await assert.rejects(failed.classify(publicEndpoint, { videos: [video] }), issue => issue.code === 'HOSTED_UNAVAILABLE' && !issue.message.includes('Google sign-in') && !issue.message.includes('Private'));
});

for (const [code, message] of [
  ['free_tier_quota_exhausted', 'Gemini provider quota has been reached. Map analysis is paused; your saved records are kept.'],
  ['project_budget_exhausted', 'Delta’s shared project AI budget is used or reserved. Your saved records are kept.'],
  ['USER_QUOTA', 'Your free AI allowance is unavailable or used up. Map analysis is paused; saved records are kept.'],
]) {
  test(`hosted ${code} preserves its typed denial and identifies the correct quota without retrying`, async () => {
    let calls = 0;
    const client = createMapAnalysisClient({ fetchImpl: async () => response({ enabled: true }), openHostedAction: async () => {
      calls++;
      throw Object.assign(Error('Private provider detail'), { code, status: 429 });
    } });
    await assert.rejects(client.classify(publicEndpoint, { videos: [video] }), issue => issue instanceof MapAnalysisError
      && issue.code === code && issue.status === 429 && issue.paused === true && issue.message === message);
    assert.equal(calls, 1);
  });
}

test('public map results keep medium and low confidence records unresolved without presenting an accuracy score', async () => {
  const videos = [video, { ...video, videoId: '12345678901' }, { ...video, videoId: '12345678902' }];
  const client = createMapAnalysisClient({ fetchImpl: async () => response({ enabled: true }), openHostedAction: async () => ({ ...result(),
    items: videos.map((item, index) => ({ ...result().items[0], videoId: item.videoId, confidence: ['high', 'medium', 'low'][index] })) }) });
  const value = await client.classify(publicEndpoint, { videos });
  assert.deepEqual(value.items.map(item => item.videoId), [video.videoId]);
  assert.deepEqual(value.unresolvedIds, ['12345678901', '12345678902']);
});

test('only HTTPS origins or local HTTP are accepted; credentials, paths and URL secrets are rejected before fetch', async () => {
  assert.equal(normalizeMapEndpoint(' https://map.example.com/ '), endpoint);
  for (const local of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787']) assert.equal(normalizeMapEndpoint(local), local);
  for (const invalid of ['http://map.example.com', 'https://user:secret@map.example.com', 'https://map.example.com/api/map/classify', 'https://map.example.com/?key=secret', 'https://map.example.com/#secret', 'javascript:alert(1)', null]) assert.throws(() => normalizeMapEndpoint(invalid), MapAnalysisError);
  let calls = 0;
  const client = createMapAnalysisClient({ fetchImpl: async () => { calls++; return response(result()); } });
  await assert.rejects(client.classify('http://remote.example', { videos: [video] }), error => error.code === 'INVALID_ENDPOINT');
  assert.equal(calls, 0);
});

test('request sends sanitized public video metadata only and owner capability exclusively in its dedicated header', async () => {
  let sent;
  const accessToken = 'private_owner_capability_1234567890';
  const client = createMapAnalysisClient({ fetchImpl: async (url, options) => { sent = { url, options }; return response(result()); } });
  const value = await client.classify(endpoint, { videos: [{ ...video, account: 'private', watchedSeconds: 99, date: '2026-10-19', notes: 'private', tasks: ['private'] }], existingPaths: [['AI tools']] }, { accessToken });
  assert.equal(sent.url, `${endpoint}/api/map/classify`);
  assert.equal(sent.options.redirect, 'error'); assert.equal(sent.options.credentials, 'omit'); assert.equal(sent.options.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(sent.options.body), { videos: [video], existingPaths: [['AI tools']] });
  assert.equal(sent.options.headers['x-delta-map-token'], accessToken);
  assert.equal(sent.options.body.includes(accessToken), false);
  assert.equal(sent.options.body.includes('private'), false);
  assert.equal(value.items[0].metadataFingerprint, mapMetadataFingerprint(video));
  assert.equal(Object.hasOwn(value.items[0], 'learningStarted'), false);
});

test('provider output cannot assign unrequested videos, duplicate assignments, non-English labels or unsupported classifications', () => {
  const mutations = [
    value => { value.schemaVersion = 2; }, value => { value.model = null; }, value => { value.cached = -1; },
    value => { value.items[0].videoId = '12345678901'; }, value => { value.items.push(value.items[0]); },
    value => { value.items[0].path = ['AI tools']; }, value => { value.items[0].path = ['AI tools', '程式代理']; },
    value => { value.items[0].path = ['AI tools', '<script>']; }, value => { value.items[0].confidence = 1; },
    value => { value.items[0].contentType = 'mixed'; }, value => { value.unresolvedIds = [video.videoId]; },
  ];
  for (const mutate of mutations) { const value = result(); mutate(value); assert.throws(() => validateMapAnalysisResponse(value, [video]), error => error.code === 'INVALID_RESPONSE'); }
  const partial = result(); partial.items = [];
  assert.deepEqual(validateMapAnalysisResponse(partial, [video]).unresolvedIds, [video.videoId]);
  partial.unresolvedIds = [video.videoId];
  assert.deepEqual(validateMapAnalysisResponse(partial, [video]).unresolved, [{ videoId: video.videoId, reason: 'Insufficient context' }]);
});

test('quota and service gates pause once, retain typed provider reason, and never automatically retry or switch provider', async () => {
  for (const [status, code] of [[429, 'free_tier_quota_exhausted'], [429, 'classification_busy'], [503, 'free_route_not_verified'], [503, 'provider_billing_required'], [403, 'invalid_map_access_token']]) {
    let calls = 0;
    const client = createMapAnalysisClient({ fetchImpl: async () => { calls++; return { ok: false, status, text: async () => JSON.stringify({ error: code, message: 'Internal provider detail is not echoed', retryAfterSeconds: 60 }) }; } });
    await assert.rejects(client.classify(endpoint, { videos: [video] }), error => error instanceof MapAnalysisError && error.code === code && error.paused === true && error.status === status && error.retryAfterMs === 60000);
    assert.equal(calls, 1);
  }
});

test('invalid responses, interrupted requests and timeouts never produce a success or leak raw provider details', async () => {
  const malformed = createMapAnalysisClient({ fetchImpl: async () => ({ ok: true, text: async () => 'not JSON' }) });
  await assert.rejects(malformed.classify(endpoint, { videos: [video] }), error => error.code === 'INVALID_RESPONSE');
  const network = createMapAnalysisClient({ fetchImpl: async () => { throw Error('Private raw provider detail'); } });
  await assert.rejects(network.classify(endpoint, { videos: [video] }), error => error.code === 'NETWORK' && !error.message.includes('Private'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(network.classify(endpoint, { videos: [video] }, { signal: controller.signal }), error => error.code === 'CANCELLED');
  const timeout = createMapAnalysisClient({ timeoutMs: 5, fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(Error('Aborted'), { name: 'AbortError' })))) });
  await assert.rejects(timeout.classify(endpoint, { videos: [video] }), error => error.code === 'TIMEOUT');
  const lateResponse = createMapAnalysisClient({ timeoutMs: 5, fetchImpl: async () => ({ ok: true, text: () => new Promise(resolve => setTimeout(() => resolve(JSON.stringify(result())), 15)) }) });
  await assert.rejects(lateResponse.classify(endpoint, { videos: [video] }), error => error.code === 'TIMEOUT', 'a late response cannot revive a cancelled batch');
});

test('oversized batches and malformed paths fail before network without truncating records; empty input needs no service call', async () => {
  let calls = 0;
  const client = createMapAnalysisClient({ fetchImpl: async () => { calls++; return response(result()); } });
  const videos = Array.from({ length: 301 }, (_, index) => ({ videoId: `v${String(index).padStart(10, '0')}`, title: 'Actual source title' }));
  await assert.rejects(client.classify(endpoint, { videos }), error => error.code === 'INVALID_REQUEST');
  await assert.rejects(client.classify(endpoint, { videos: [video], existingPaths: [['人工智能']] }), error => error.code === 'INVALID_REQUEST');
  await assert.rejects(client.classify(endpoint, { videos: [video], existingPaths: Array.from({ length: 81 }, () => ['AI tools']) }), error => error.code === 'INVALID_REQUEST');
  await assert.rejects(client.classify(endpoint, { videos: [video] }, { accessToken: 'bad\ntoken' }), error => error.code === 'INVALID_ACCESS_TOKEN');
  assert.equal((await client.classify(endpoint, { videos: [] })).items.length, 0);
  assert.equal(calls, 0);
});
