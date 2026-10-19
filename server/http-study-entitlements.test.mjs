import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from './index.mjs';
import {createStudyEntitlements} from './study/entitlements.mjs';
import {StudyError} from './study/source.mjs';

async function setup(t, withEntitlements = true) {
  const documents = new Map(); let chain = Promise.resolve(), providerCalls = 0;
  const store = {transact(user, operation, videos, reduce) {
    const run = chain.catch(() => {}).then(async () => {
      const value = key => structuredClone(documents.get(key) ?? null);
      const update = await reduce(value(user), operation ? value(`${user}/op/${operation}`) : null,
        videos.map(id => value(`${user}/vid/${id}`)));
      if (update.account) documents.set(user, structuredClone(update.account));
      if (update.operation) documents.set(`${user}/op/${operation}`, structuredClone(update.operation));
      for (const [id, entry] of update.registrations || []) documents.set(`${user}/vid/${id}`, structuredClone(entry));
      return update.result;
    }); chain = run; return run;
  }};
  const studyEntitlements = withEntitlements ? createStudyEntitlements({store, key: Buffer.alloc(32, 63)}) : null;
  const studyAccounts = {config: () => ({enabled: true, firebase: {authDomain: 'test.firebaseapp.com'}}),
    async authenticate(request) {
      const token = request.headers.authorization;
      if (!['Bearer alice', 'Bearer bob'].includes(token)) throw new StudyError('authentication_required', 401);
      return {uid: token.slice(7)};
    }, forUser: () => ({snapshot: async () => ({limitUsd: .5, reservedUsd: 0, spentUsd: 0, remainingUsd: .5})})};
  const studyService = {access: {mode: 'google', check: () => null}, inspect: async () => ({saved: true})};
  const classificationService = {classify: async () => {providerCalls++; return {items: []};}};
  const server = createServer({studyService, studyAccounts, studyEntitlements, classificationService, requestsPerMinute: 200});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(action, body, token = 'alice') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/study/${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {...(token ? {authorization: `Bearer ${token}`} : {}), ...(body === undefined ? {} : {'content-type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    return {status: response.status, body: await response.json()};
  }
  return {request, providerCalls: () => providerCalls};
}
const ids = Array.from({length: 10}, (_, i) => String(i).padStart(11, '0'));

test('real HTTP entry authenticates and enforces cumulative imports without changing free AI allowance', async t => {
  const {request} = await setup(t);
  assert.equal((await request('entitlements', undefined, null)).status, 401);
  assert.equal((await request('registerImports', {operationId: 'one', videoIds: ids}, null)).status, 401);
  assert.equal((await request('registerImports', {operationId: 'one', videoIds: ids})).status, 200);
  assert.equal((await request('entitlements')).body.imports.remaining, 0);
  assert.equal((await request('entitlements', undefined, 'bob')).body.imports.remaining, 10);
  assert.equal((await request('registerImports', {operationId: 'two', videoIds: ['abcdefghijk']})).status, 402);
  assert.equal((await request('session')).body.quota.remainingUsd, .5);
});

test('direct classification cannot bypass import registration or use another account registration', async t => {
  const {request, providerCalls} = await setup(t), body = {videos: [{videoId: ids[0], title: 'Example'}]};
  assert.equal((await request('classify', body)).status, 403);
  assert.equal(providerCalls(), 0);
  await request('registerImports', {operationId: 'one', videoIds: [ids[0]]});
  assert.equal((await request('classify', body, 'bob')).status, 403);
  assert.equal((await request('classify', body)).status, 200);
  assert.equal(providerCalls(), 1);
});

test('missing import ledger closes new registration and analysis but preserves saved-content routes', async t => {
  const {request, providerCalls} = await setup(t, false);
  assert.equal((await request('registerImports', {operationId: 'one', videoIds: [ids[0]]})).status, 503);
  assert.equal((await request('classify', {videos: [{videoId: ids[0]}]})).status, 503);
  assert.equal(providerCalls(), 0);
  assert.equal((await request('inspect', {})).status, 200);
  assert.equal((await request('session')).body.quota.remainingUsd, .5);
});
