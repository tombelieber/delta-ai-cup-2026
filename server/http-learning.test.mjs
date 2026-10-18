import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './index.mjs';
import { LearningError } from './learning.mjs';

async function setup(t) {
  const learningService = {
    readiness: () => ({ configured: true, skill: 'sumif-text-equality' }),
    generate: async (input) => {
      if (input.scenario === 'quota') {
        const error = new LearningError('free_tier_quota_exhausted', 429, 'The free allowance is unavailable.');
        error.retryAfterSeconds = 60;
        throw error;
      }
      return { lesson: { summary: input.source.title }, lessonToken: 'signed-test-only' };
    },
    validate: async (input) => ({ passed: input.formula === '=SUMIF(A2:A5,D2,B2:B5)' }),
    reteach: async () => { throw new LearningError('invalid_lesson', 400, 'Create a lesson first.'); },
    exportPptx: async () => ({ buffer: Buffer.from('PK-test-pptx'), filename: 'Delta-test.pptx', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }),
  };
  const service = { readiness: () => ({ configured: false }), recommend: async () => ({ status: 'no_history' }) };
  const server = createServer({ service, learningService, allowChromeExtensions: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (action, body, headers = {}) => fetch(`${origin}/api/learning/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { origin, post };
}

test('learning HTTP routes share deployment health and preserve typed error status', async (t) => {
  const { origin, post } = await setup(t);
  const health = await (await fetch(`${origin}/api/health`)).json();
  assert.equal(health.version, '0.7.0');
  assert.equal(health.learning.configured, true);
  const lesson = await post('generate', { source: { title: 'SUMIF lesson' } });
  assert.equal(lesson.status, 200);
  assert.equal((await lesson.json()).lesson.summary, 'SUMIF lesson');
  assert.equal((await post('validate', { formula: '=SUMIF(A2:A5,D2,B2:B5)' })).status, 200);
  const hint = await post('reteach', {});
  assert.equal(hint.status, 400);
  assert.equal((await hint.json()).error, 'invalid_lesson');
});

test('learning accepts bounded signed lessons, rejects foreign origins and excessive bodies', async (t) => {
  const { origin, post } = await setup(t);
  assert.equal((await post('validate', { lessonToken: 'x'.repeat(20000), formula: '' })).status, 200);
  assert.equal((await post('validate', { lessonToken: 'x'.repeat(66000) })).status, 413);
  assert.equal((await post('generate', {}, { origin: 'https://unrelated.invalid' })).status, 403);
  assert.equal((await post('generate', {}, { origin: `chrome-extension://${'a'.repeat(32)}` })).status, 500);
  assert.equal((await fetch(`${origin}/api/learning/generate`)).status, 405);
  assert.equal((await post('generate', {}, { 'content-type': 'text/plain' })).status, 415);
  const malformed = await fetch(`${origin}/api/learning/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
});

test('PPTX route serves binary attachment with no caching', async (t) => {
  const { post } = await setup(t);
  const response = await post('pptx', { lessonToken: 'signed-test-only' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /presentationml.presentation/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="Delta-test.pptx"');
  assert.equal(await response.text(), 'PK-test-pptx');
});

test('learning HTTP quota errors expose a bounded cooldown without converting it to a provider retry', async (t) => {
  const { post } = await setup(t);
  const response = await post('generate', { scenario: 'quota' });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal((await response.json()).error, 'free_tier_quota_exhausted');
});
