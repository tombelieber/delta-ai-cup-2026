import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudyEntitlements, createFirestoreEntitlementStore} from './study/entitlements.mjs';

// The real reducer runs over a serialized durable-store seam; only Firestore IO is replaced.
class Store {
  accounts = new Map(); registrations = new Map(); operations = new Map(); chain = Promise.resolve();
  transact(user, operation, videos, reduce) {
    const next = this.chain.catch(() => {}).then(async () => {
      const read = map => structuredClone(map.get(`${user}/${operation}`) ?? null);
      const update = await reduce(structuredClone(this.accounts.get(user) ?? null),
        operation ? read(this.operations) : null,
        videos.map(key => structuredClone(this.registrations.get(`${user}/${key}`) ?? null)));
      if (update.account) this.accounts.set(user, structuredClone(update.account));
      if (update.operation) this.operations.set(`${user}/${operation}`, structuredClone(update.operation));
      for (const [key, value] of update.registrations || []) this.registrations.set(`${user}/${key}`, structuredClone(value));
      return structuredClone(update.result);
    });
    this.chain = next; return next;
  }
}
const video = n => String(n).padStart(11, '0');
const ten = Array.from({length: 10}, (_, i) => video(i));
const key = Buffer.alloc(32, 71);
const fixture = (store = new Store()) => ({store, service: createStudyEntitlements({store, key, now: () => 1000})});

test('ten unique imports survive a service restart and the eleventh is denied', async () => {
  const {store, service} = fixture();
  const admitted = await service.forUser('alice').register({operationId: 'first', videoIds: ten});
  assert.equal(admitted.added, 10);
  assert.deepEqual(admitted.imports, {limit: 10, used: 10, remaining: 0});
  const restarted = fixture(store).service.forUser('alice');
  assert.equal((await restarted.snapshot()).imports.remaining, 0);
  await assert.rejects(restarted.register({operationId: 'eleventh', videoIds: [video(10)]}),
    {code: 'import_allowance_exhausted', status: 402});
  assert.equal((await restarted.snapshot()).imports.used, 10);
});

test('duplicates, replay and reimport do not consume more registrations; changed replay is rejected', async () => {
  const {service} = fixture(), user = service.forUser('alice');
  const input = {operationId: 'save', videoIds: [video(1), video(1)]};
  assert.equal((await user.register(input)).added, 1);
  assert.equal((await user.register(input)).added, 1);
  assert.equal((await user.register({operationId: 'reimport', videoIds: [video(1)]})).added, 0);
  assert.equal((await user.snapshot()).imports.used, 1);
  await assert.rejects(user.register({...input, videoIds: [video(2)]}), {code: 'import_operation_conflict', status: 409});
});

test('concurrent clients cannot register an eleventh distinct video', async () => {
  const {service, store} = fixture();
  await service.forUser('alice').register({operationId: 'nine', videoIds: ten.slice(0, 9)});
  const other = fixture(store).service;
  const results = await Promise.allSettled([
    service.forUser('alice').register({operationId: 'a', videoIds: [video(9)]}),
    other.forUser('alice').register({operationId: 'b', videoIds: [video(10)]}),
  ]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.find(x => x.status === 'rejected').reason.code, 'import_allowance_exhausted');
  assert.equal((await other.forUser('alice').snapshot()).imports.used, 10);
});

test('registration and processing are account scoped and server storage contains no plaintext identity/video IDs', async () => {
  const {service, store} = fixture(), alice = service.forUser('alice');
  await alice.register({operationId: 'private-operation', videoIds: [video(7)]});
  await alice.assertRegistered([video(7)]);
  await assert.rejects(service.forUser('bob').assertRegistered([video(7)]), {code: 'import_registration_required', status: 403});
  assert.equal((await service.forUser('bob').snapshot()).imports.remaining, 10);
  const serialized = JSON.stringify([...store.accounts, ...store.registrations, ...store.operations]);
  for (const raw of ['alice', 'private-operation', video(7)]) assert.equal(serialized.includes(raw), false);
});

test('malformed or client-granted registrations cannot change the balance and sales stay disabled', async () => {
  const {service} = fixture(), user = service.forUser('alice');
  for (const input of [{operationId: 'x', videoIds: []}, {operationId: 'x', videoIds: ['invalid-id']},
    {operationId: 'x', videoIds: ten, limit: 1000}, {operationId: '', videoIds: ten},
    {operationId: 'x', videoIds: Array.from({length: 101}, (_, i) => video(i))}]) {
    await assert.rejects(user.register(input), {code: 'invalid_import_registration', status: 400});
  }
  assert.equal((await user.snapshot()).imports.used, 0);
  assert.equal((await user.snapshot()).starterPack.available, false);
  assert.equal((await user.snapshot()).starterPack.priceUsd, 5);
});

test('corrupt persisted counters fail closed instead of resetting free registrations', async () => {
  const {service, store} = fixture();
  await service.forUser('alice').register({operationId: 'one', videoIds: [video(1)]});
  const [id, value] = [...store.accounts][0]; store.accounts.set(id, {...value, usedImports: -1});
  await assert.rejects(service.forUser('alice').snapshot(), {code: 'import_ledger_unavailable', status: 503});
});

test('Firestore adapter batches reads before writes and retries the pure transition safely', async () => {
  const database = new Map(), calls = [];
  const doc = path => ({path, collection: name => ({doc: id => doc(`${path}/${name}/${id}`)})});
  const firestore = {
    collection: name => ({doc: id => doc(`${name}/${id}`)}),
    async runTransaction(run) {
      const attempt = async commit => {
        let wrote = false; const pending = [];
        const result = await run({
          async getAll(...refs) {assert.equal(wrote, false); calls.push(refs.length);
            return refs.map(ref => ({exists: database.has(ref.path), data: () => structuredClone(database.get(ref.path))}));},
          set(ref, value) {wrote = true; pending.push([ref.path, structuredClone(value)]);},
        });
        if (commit) for (const [path, value] of pending) database.set(path, value);
        return result;
      };
      await attempt(false); return attempt(true);
    },
  };
  const service = fixture(createFirestoreEntitlementStore(firestore)).service;
  await service.forUser('alice').register({operationId: 'first', videoIds: ten});
  assert.equal((await service.forUser('alice').snapshot()).imports.used, 10);
  assert.ok(calls.includes(12));
  assert.equal([...database.keys()].filter(x => x.includes('/videos/')).length, 10);
});
