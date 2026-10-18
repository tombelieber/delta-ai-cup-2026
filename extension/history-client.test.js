import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryClient, isHistoryClientAvailable, HistoryImportError } from './history-client.js';

const videoId = 'dI8w0utjUc0';
const visit = { videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: 'SUMIF lesson', lastVisitTime: 1700000000000 };
const status = () => ({ ok: true, granted: true, visits: [{ ...visit, importedAt: 1700000001000 }], updatedAt: 1700000001000 });
const preview = () => ({ ok: true, token: 'bounded-worker-token', visits: [visit], days: 30, truncated: false });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture({ grant = true, response = null, permissionError = null } = {}) {
  const events = [];
  const runtime = { async sendMessage(message) { events.push(message); return response ? response(message) : message.type === 'HISTORY_PREVIEW' ? preview() : message.type === 'HISTORY_CANCEL' ? { ok: true } : status(); } };
  const permissions = { request(value) { events.push({ permissionRequest: value }); if (permissionError) throw permissionError; return typeof grant === 'function' ? grant() : Promise.resolve(grant); }, async contains() { throw new Error('Permission preflight must never run'); } };
  return { client: createHistoryClient({ runtime, permissions }), runtime, permissions, events };
}

test('permission request happens synchronously before the first await or runtime message', async () => {
  const nativePrompt = deferred();
  const { client, events } = fixture({ grant: () => nativePrompt.promise });
  const pending = client.preview(30);
  assert.deepEqual(events, [{ permissionRequest: { permissions: ['history'] } }], 'native prompt must be requested in the direct click turn');
  nativePrompt.resolve(true);
  const result = await pending;
  assert.deepEqual(events, [{ permissionRequest: { permissions: ['history'] } }, { type: 'HISTORY_PREVIEW', days: 30 }]);
  assert.deepEqual(result, preview());
});

test('mount/status never asks for permission; denial never requests a preview or search', async () => {
  const { client, events } = fixture({ grant: false });
  assert.equal(client.available, true);
  assert.deepEqual(events, []);
  assert.deepEqual(await client.status(), status());
  assert.deepEqual(events, [{ type: 'HISTORY_STATUS' }]);
  await assert.rejects(client.preview(), (error) => error instanceof HistoryImportError && error.code === 'permission_denied' && /keep using lessons/.test(error.message));
  assert.deepEqual(events, [{ type: 'HISTORY_STATUS' }, { permissionRequest: { permissions: ['history'] } }]);
});

test('messages carry only the selected IDs and token; management uses explicit worker actions', async () => {
  const { client, events } = fixture();
  await client.importSelected('review-token', [videoId, videoId]);
  await client.clear();
  await client.disconnect();
  await client.cancel();
  assert.deepEqual(events, [
    { type: 'HISTORY_IMPORT', token: 'review-token', videoIds: [videoId] },
    { type: 'HISTORY_CLEAR' }, { type: 'HISTORY_DISCONNECT' }, { type: 'HISTORY_CANCEL' },
  ]);
});

test('unsupported contexts remain usable without trying Chrome APIs', async () => {
  assert.equal(isHistoryClientAvailable(), false);
  assert.equal(isHistoryClientAvailable({ runtime: { sendMessage() {} } }), false);
  const client = createHistoryClient();
  assert.equal(client.available, false);
  await assert.rejects(client.status(), { code: 'unavailable' });
  await assert.rejects(client.preview(), { code: 'unavailable' });
});

test('invalid ranges and selections never request permission or send runtime messages', async () => {
  const { client, events } = fixture();
  for (const days of [0, 365, '30', null]) await assert.rejects(client.preview(days), { code: 'invalid_days' });
  for (const [token, ids] of [['', [videoId]], ['x', []], ['x', ['javascript:alert(1)']], ['x', null]]) await assert.rejects(client.importSelected(token, ids), { code: 'invalid_selection' });
  assert.deepEqual(events, []);
});

test('cancelling while the native prompt is open prevents a later granted scan', async () => {
  const nativePrompt = deferred();
  const { client, events } = fixture({ grant: () => nativePrompt.promise });
  const pending = client.preview(7);
  await client.cancel();
  nativePrompt.resolve(true);
  await assert.rejects(pending, { code: 'cancelled' });
  assert.deepEqual(events, [{ permissionRequest: { permissions: ['history'] } }, { type: 'HISTORY_CANCEL' }]);
});

test('late preview and import responses cannot reopen a cancelled review or claim success', async () => {
  for (const type of ['HISTORY_PREVIEW', 'HISTORY_IMPORT']) {
    const worker = deferred();
    const { client, events } = fixture({ response: (message) => message.type === type ? worker.promise : { ok: true } });
    const pending = type === 'HISTORY_PREVIEW' ? client.preview() : client.importSelected('review-token', [videoId]);
    await Promise.resolve();
    assert.equal(events.some((event) => event.type === type), true);
    await client.cancel();
    worker.resolve(type === 'HISTORY_PREVIEW' ? preview() : status());
    await assert.rejects(pending, { code: 'cancelled' });
  }
});

test('Chrome errors are readable English and fail without a history scan', async () => {
  const unavailable = fixture({ permissionError: new Error('Must be called in a user gesture') });
  await assert.rejects(unavailable.client.preview(), { code: 'permission_error' });
  assert.equal(unavailable.events.filter((event) => event.type).length, 0);
  const rejectedPrompt = fixture({ grant: () => Promise.reject(Error('dismissed')) });
  await assert.rejects(rejectedPrompt.client.preview(), { code: 'permission_error' });
  const workerFailure = fixture({ response: () => ({ ok: false, code: 'permission_required', error: 'Allow Chrome history access before scanning.' }) });
  await assert.rejects(workerFailure.client.status(), { code: 'permission_required', message: 'Allow Chrome history access before scanning.' });
  const rawFailure = fixture({ response: () => { throw Error('private internal data'); } });
  await assert.rejects(rawFailure.client.status(), { code: 'connection_error', message: 'Delta could not reach Chrome history. Reload the extension and try again.' });
});

test('only worker canonical YouTube links can enter review or imported lists', async () => {
  for (const url of ['javascript:alert(1)', 'https://youtube.com.evil/watch?v=dI8w0utjUc0', `${visit.url}&tracking=private`, 'https://www.youtube.com/watch?v=En5cSXgGvZM']) {
    const { client } = fixture({ response: () => ({ ...status(), visits: [{ ...visit, url }] }) });
    await assert.rejects(client.status(), { code: 'invalid_response' });
  }
  const duplicate = fixture({ response: () => ({ ...status(), visits: [visit, visit] }) });
  await assert.rejects(duplicate.client.status(), { code: 'invalid_response' });
  const wrongShape = fixture({ response: () => ({ ok: true, visits: {} }) });
  await assert.rejects(wrongShape.client.status(), { code: 'invalid_response' });
});
