import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationGate } from './generation-gate.mjs';

const freeEnv = () => ({ AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_FREE_TIER_ONLY: 'true',
  GEMINI_API_PROJECT: 'gen-lang-client-0441267635',
  GEMINI_API_KEY_RESOURCE: 'projects/2937676390/locations/global/keys/c8631e91-1d44-4033-a5b6-1857223f4778' });

test('free-only gate rejects every different route/model/project/key owner and respects the pause', () => {
  for (const change of [{ AI_PROVIDER: 'vertex' }, { GEMINI_MODEL: 'gemini-2.5-flash' },
    { GEMINI_API_PROJECT: 'another-project' }, { GEMINI_API_KEY_RESOURCE: '' },
    { GEMINI_API_KEY_RESOURCE: 'projects/111/locations/global/keys/elsewhere' }]) {
    assert.equal(createGenerationGate({ env: { ...freeEnv(), ...change } }).reserve().reason, 'free_route_not_verified');
  }
  const gate = createGenerationGate({ env: freeEnv() });
  assert.equal(gate.reserve({ transport: 'vertex', model: 'gemini-3.8-flash' }).reason, 'free_route_not_verified');
  assert.equal(gate.reserve(), null);
  assert.equal(createGenerationGate({ env: { ...freeEnv(), AI_GENERATION_DISABLED: 'true' } }).reason(), 'generation_disabled');
});

test('shared gate reserves requests synchronously across callers and enforces a rolling minute', () => {
  let time = Date.parse('2026-10-17T10:00:00Z');
  const gate = createGenerationGate({ env: freeEnv(), now: () => time });
  for (let i = 0; i < 5; i++) assert.equal(gate.reserve(), null);
  assert.equal(gate.reserve().reason, 'free_tier_quota_exhausted');
  assert.equal(gate.reserve().retryAfterSeconds, 60);
  time += 59999; assert.equal(gate.reserve().retryAfterSeconds, 1);
  time++; assert.equal(gate.reserve(), null);
  assert.equal(gate.status().requestsToday, 6);
});

test('twenty daily requests stop before fetch and reset at Pacific midnight, not UTC midnight', () => {
  let time = Date.parse('2026-10-18T06:50:00Z');
  const gate = createGenerationGate({ env: freeEnv(), now: () => time });
  for (let i = 0; i < 20; i++) { assert.equal(gate.reserve(), null); time += 61000; }
  // The loop crossed Pacific midnight; start a second complete day to test its cap.
  time = Date.parse('2026-10-18T08:00:00Z');
  const day = createGenerationGate({ env: freeEnv(), now: () => time });
  for (let i = 0; i < 20; i++) { assert.equal(day.reserve(), null); time += 61000; }
  assert.equal(day.reserve().reason, 'free_tier_quota_exhausted');
  time = Date.parse('2026-10-19T00:01:00Z'); assert.equal(day.reserve().reason, 'free_tier_quota_exhausted');
  time = Date.parse('2026-10-19T07:00:00Z'); assert.equal(day.reserve(), null);
  assert.equal(day.status().requestsToday, 1);
});

test('provider quota response blocks all users of the gate with a bounded cooldown and no retry loop', () => {
  let time = Date.parse('2026-10-17T10:00:00Z');
  const gate = createGenerationGate({ env: freeEnv(), now: () => time });
  assert.equal(gate.observeResponse(429, '120').reason, 'free_tier_quota_exhausted');
  assert.equal(gate.reserve().retryAfterSeconds, 120);
  time += 120000; assert.equal(gate.reserve(), null);
  assert.equal(gate.observeResponse(429, 'secret https://elsewhere.invalid/?key=private').retryAfterSeconds, 60);
  assert.equal(JSON.stringify(gate.status()).includes('private'), false);
});

test('billing-required response latches closed across services while offline operations need no reservation', () => {
  const gate = createGenerationGate({ env: freeEnv() });
  assert.equal(gate.observeResponse(402).reason, 'provider_billing_required');
  assert.equal(gate.reason(), 'provider_billing_required');
  assert.equal(gate.reserve().reason, 'provider_billing_required');
  assert.equal(gate.observeResponse(200), null);
  assert.equal(gate.reserve().reason, 'provider_billing_required');
});
