import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebSkillStorage } from '../src/learning/skill-storage.js';

function fixture() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let chain = Promise.resolve();
  const locks = { request(_name, fn) { const work = chain.then(fn); chain = work.catch(() => {}); return work; } };
  return { values, storage, locks, store: () => createWebSkillStorage({ storage, locks }) };
}
test('website skill writes reject a stale view and explicit clearing stays independent', async () => {
  const f = fixture(), first = f.store(), stale = f.store();
  f.values.set('delta-learning-live-v1', 'lesson-and-formula'); f.values.set('watch-record', 'watched-ranges');
  assert.equal(await first.get(), null); await stale.get();
  await first.set('ignored', { schemaVersion: 1, familiarity: { basic: true } });
  await assert.rejects(stale.set('ignored', { schemaVersion: 1, evidence: [] }), /Another Delta tab/);
  await stale.get(); await stale.set('ignored', { schemaVersion: 1, familiarity: {}, evidence: [] });
  assert.deepEqual(await first.get(), { schemaVersion: 1, familiarity: {}, evidence: [] });
  assert.equal(f.values.get('delta-learning-live-v1'), 'lesson-and-formula');
  assert.equal(f.values.get('watch-record'), 'watched-ranges');
});
test('unreadable website records and missing safe storage do not overwrite saved data', async () => {
  const f = fixture(); f.values.set('delta-skill-tree-v1', '{broken');
  const store = f.store(); await assert.rejects(store.get());
  await assert.rejects(store.set('ignored', {}), /Read the skill record/);
  assert.equal(f.values.get('delta-skill-tree-v1'), '{broken');
  f.values.delete('delta-skill-tree-v1');
  const unavailable = createWebSkillStorage({ storage: f.storage, locks: {} });
  await unavailable.get(); await assert.rejects(unavailable.set('ignored', {}), /Safe local skill storage/);
  assert.equal(f.values.has('delta-skill-tree-v1'), false);
});
