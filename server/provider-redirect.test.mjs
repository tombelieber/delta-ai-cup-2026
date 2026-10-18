import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGeminiProvider } from './gemini.mjs';
import { createLearningService } from './learning.mjs';

for (const consumer of ['recommendation', 'lesson']) {
  test(`${consumer} never follows a provider redirect or forwards its fake API key to another origin`, async (t) => {
    let forwarded = 0;
    const destination = http.createServer((req, res) => {
      forwarded++; req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] }));
    });
    await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve));
    const origin = http.createServer((req, res) => {
      req.resume(); res.writeHead(307, { location: `http://127.0.0.1:${destination.address().port}/redirected` }); res.end();
    });
    await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
    t.after(async () => { for (const server of [origin, destination]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
    const env = { AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_API_KEY: 'test-only-fake-key' };
    const fetchImpl = (url, options) => {
      assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
      return fetch(`http://127.0.0.1:${origin.address().port}/provider`, options);
    };
    const work = consumer === 'lesson'
      ? createLearningService({ env, fetchImpl, timeoutMs: 1000 }).generate({ source: { videoUrl: 'https://www.youtube.com/watch?v=dI8w0utjUc0', start: 35, end: 186 }, profile: { language: 'en' } })
      : createGeminiProvider({ env, fetchImpl, timeoutMs: 1000 }).choose({ memory: [], candidates: [] });
    await assert.rejects(work, error => error.code === 'provider_unavailable');
    assert.equal(forwarded, 0);
  });
}
