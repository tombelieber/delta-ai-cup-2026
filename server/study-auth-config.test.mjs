import test from 'node:test';
import assert from 'node:assert/strict';
import {readStudyAuthConfig, STUDY_BOOTSTRAP_TIMEOUT_MS} from '../src/learning/study-auth-config.mjs';

const configuration = {enabled: false, limitUsd: .5};
const ok = () => new Response(JSON.stringify(configuration));

test('bootstrap tolerates a transient platform failure with one anonymous GET retry', async () => {
  const calls = [];
  const config = await readStudyAuthConfig({endpoint: 'https://delta.example/', retryDelayMs: 0,
    fetchImpl: async (url, init) => {calls.push({url, init}); return calls.length === 1 ? new Response('', {status: 503}) : ok();}});
  assert.deepEqual(config, configuration);
  assert.equal(calls.length, 2);
  for (const {url, init} of calls) {
    assert.equal(url, 'https://delta.example/api/study/auth-config');
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.headers, undefined);
    assert.equal(init.body, undefined);
  }
});

test('a repeated platform failure stops after two attempts', async () => {
  let calls = 0;
  await assert.rejects(readStudyAuthConfig({retryDelayMs: 0, fetchImpl: async () => {calls++; return new Response('', {status: 500});}}), {status: 500});
  assert.equal(calls, 2);
});

test('authorization, quota and missing-route failures are never retried', async () => {
  for (const status of [401, 403, 404, 429]) {
    let calls = 0;
    await assert.rejects(readStudyAuthConfig({retryDelayMs: 0, fetchImpl: async () => {calls++; return new Response('', {status});}}), {status});
    assert.equal(calls, 1);
  }
});

test('network/security errors and invalid configuration are never retried', async () => {
  for (const reply of [() => {throw new TypeError('fetch rejected');}, () => new Response('invalid JSON'), () => new Response('{}')]) {
    let calls = 0;
    await assert.rejects(readStudyAuthConfig({retryDelayMs: 0, fetchImpl: async () => {calls++; return reply();}}));
    assert.equal(calls, 1);
  }
});

test('one 45-second deadline is shared by both attempts', async t => {
  const deadlines = [], signals = [], controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', milliseconds => {deadlines.push(milliseconds); return controller.signal;});
  await readStudyAuthConfig({retryDelayMs: 0, fetchImpl: async (_url, init) => {signals.push(init.signal); return signals.length === 1 ? new Response('', {status: 502}) : ok();}});
  assert.equal(STUDY_BOOTSTRAP_TIMEOUT_MS, 45000);
  assert.deepEqual(deadlines, [45000]);
  assert.equal(signals[0], signals[1]);
});

test('leaving during backoff cancels the retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = readStudyAuthConfig({signal: controller.signal, retryDelayMs: 1000, fetchImpl: async () => {
    calls++; setTimeout(() => controller.abort(), 0); return new Response('', {status: 504});
  }});
  await assert.rejects(result, {name: 'AbortError'});
  assert.equal(calls, 1);
});

test('an already canceled page performs no request', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(readStudyAuthConfig({signal: controller.signal, fetchImpl: async () => {calls++; return ok();}}), {name: 'AbortError'});
  assert.equal(calls, 0);
});
