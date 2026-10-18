import { isYouTubeUrl, validVideoId, youtubeVideoId } from './store.js';
import { normalizeApiEndpoint, endpointPermission } from './analysis-client.js';
import { HISTORY_IMPORT_KEY, normalizeImportedHistory } from './history-import.js';
import { ACCOUNT_HISTORY_KEY, normalizeAccountHistory } from './account-history.js';
import { topicForVideo } from './learning-journal.js';
import { SKILLS_STORE_KEY, normalizeSkills } from '../src/learning/skill-records.mjs';
export { SKILLS_STORE_KEY } from '../src/learning/skill-records.mjs';

export const LEARNING_STORE_PREFIX = 'delta.learning.workspace.v1.';
export const LEARNING_ROUTES = Object.freeze({ generate: '/api/learning/generate', validate: '/api/learning/validate', reteach: '/api/learning/reteach', pptx: '/api/learning/pptx' });
const MAX_STATE_BYTES = 250_000;
const boundedText = (value, max, label, empty = false) => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw Error(`Invalid ${label}.`);
  return value;
};
export function normalizeLearningPayload(action, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid learning request.');
  if (action === 'generate') {
    const source = payload.source;
    const url = boundedText(source?.videoUrl, 2048, 'video URL');
    if (!isYouTubeUrl(url) || !validVideoId(youtubeVideoId(url))) throw Error('Enter a valid YouTube video URL.');
    const start = source.start ?? 0, end = source.end ?? start + 180;
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start || end - start > 300 || end > 86400) throw Error('Choose a valid clip of up to five minutes.');
    const profile = payload.profile || {};
    if (!Array.isArray(profile.interests) || profile.interests.length > 5) throw Error('Choose up to five interests.');
    if (!['beginner', 'some-experience'].includes(profile.level) || !['en', 'zh-HK'].includes(profile.language)) throw Error('Invalid learning preferences.');
    return { source: { videoUrl: `https://www.youtube.com/watch?v=${youtubeVideoId(url)}`, title: boundedText(source.title || '', 300, 'video title', true), start, end },
      profile: { interests: profile.interests.map((value) => boundedText(value, 80, 'interest')), level: profile.level, language: profile.language } };
  }
  if (!Object.hasOwn(LEARNING_ROUTES, action)) throw Error('Unsupported learning action.');
  const lessonToken = boundedText(payload.lessonToken, 100_000, 'lesson token');
  if (action === 'pptx') return { lessonToken };
  const formula = boundedText(payload.formula, 1000, 'formula', true);
  if (payload.taskId === undefined) return { lessonToken, formula };
  const taskId = boundedText(payload.taskId, 100, 'practice task ID');
  if (/[\u0000-\u001f]/.test(taskId)) throw Error('Invalid practice task ID.');
  return { lessonToken, formula, taskId };
}
export function interestSuggestions(data, importedVisits = [], accountEntries = []) {
  const watched = new Map(Object.entries(data?.videos || {}).filter(([, video]) => Array.isArray(video.ranges) && video.ranges.some(([a, b]) => b > a)));
  const imported = new Map();
  for (const visit of (Array.isArray(importedVisits) ? importedVisits : []).slice(0, 1000)) {
    if (!validVideoId(visit?.videoId) || typeof visit.title !== 'string' || watched.has(visit.videoId) || imported.has(visit.videoId)) continue;
    imported.set(visit.videoId, { title: visit.title.slice(0, 300) });
  }
  const account = new Map();
  for (const entry of Array.isArray(accountEntries) ? accountEntries : []) {
    if (!validVideoId(entry?.videoId) || typeof entry.title !== 'string' || watched.has(entry.videoId) || imported.has(entry.videoId) || account.has(entry.videoId)) continue;
    account.set(entry.videoId, { title: entry.title.slice(0, 300) });
  }
  const videos = [...watched.values(), ...imported.values(), ...account.values()];
  const source = account.size ? 'youtube-account-history-and-delta' : imported.size ? (watched.size ? 'delta-observed-and-imported' : 'imported-visits') : 'delta-observed';
  const message = account.size ? 'Local topic hints from imported YouTube watch history and other Delta records. History does not prove understanding or skills. Review suggestions before using them.' : imported.size
    ? `Local topic hints from ${watched.size ? 'observed playback and imported' : 'imported'} YouTube page titles. Imported visits do not prove playback or skills. Review suggestions before using them.`
    : watched.size
      ? 'Local suggestions from video titles with playback recorded by Delta on this Chrome browser. Review suggestions before using them.'
      : 'No local topic hints yet. Keep watching to discover suggestions. You can start learning without filling in interests.';
  const counts = new Map();
  for (const video of videos) {
    const topic = topicForVideo({ title: video.title });
    if (topic.id.startsWith('other:')) continue;
    counts.set(topic.label, (counts.get(topic.label) || 0) + 1);
  }
  return { source, suggestions: [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count), message };
}
export function learningMetadata(saved, endpoint) {
  return saved?.endpoint === endpoint ? { revision: Number.isSafeInteger(saved.revision) && saved.revision >= 0 ? saved.revision : 0,
    writerId: typeof saved.writerId === 'string' ? saved.writerId.slice(0, 100) : '' } : { revision: 0, writerId: '' };
}
export function skillsMetadata(saved) {
  return { skillsRevision: Number.isSafeInteger(saved?.revision) && saved.revision >= 0 ? saved.revision : 0,
    skillsWriterId: typeof saved?.writerId === 'string' ? saved.writerId.slice(0, 100) : '' };
}
export function createLearningHandler({ api, repository, readEndpoint, panelSender, contentSender, fetchImpl = globalThis.fetch }) {
  let stateWrites = Promise.resolve();
  const checkVideo = (videoId, sender) => {
    if (!validVideoId(videoId)) throw Error('Invalid video ID.');
    if (contentSender(sender) && youtubeVideoId(sender.url) !== videoId) throw Error('Use learning content for the current video.');
  };
  return async function handleLearning(message, sender) {
    if (!panelSender(sender) && !contentSender(sender)) throw Error('Unauthorized learning message source.');
    if (message.type === 'LEARNING_INTERESTS') {
      const stored = (await api.storage.local.get(HISTORY_IMPORT_KEY))[HISTORY_IMPORT_KEY];
      const imported = normalizeImportedHistory(stored).visits;
      const history = normalizeAccountHistory((await api.storage.local.get(ACCOUNT_HISTORY_KEY))[ACCOUNT_HISTORY_KEY]);
      return { ok: true, result: interestSuggestions(await repository.read(), imported, history.accounts[history.activeAccountKey]?.entries || []) };
    }
    const skillsMessage = ['LEARNING_SKILLS_GET', 'LEARNING_SKILLS_SET'].includes(message.type);
    if (!skillsMessage || contentSender(sender)) checkVideo(message.videoId, sender);
    const endpoint = normalizeApiEndpoint(await readEndpoint());
    if (message.expectedEndpoint !== endpoint) throw Error('Learning service settings changed. Wait for the sidebar to update, then try again.');
    if (skillsMessage) {
      if (message.type === 'LEARNING_SKILLS_GET') {
        const saved = (await api.storage.local.get(SKILLS_STORE_KEY))[SKILLS_STORE_KEY];
        const metadata = skillsMetadata(saved);
        return { ok: true, value: saved === undefined ? null : normalizeSkills(saved?.value), endpoint,
          revision: metadata.skillsRevision, writerId: metadata.skillsWriterId };
      }
      if (!message.value || typeof message.value !== 'object' || Array.isArray(message.value) || message.value.schemaVersion !== 1
        || JSON.stringify(message.value).length > 50_000) throw Error('Invalid skill record format or size.');
      if (!Number.isSafeInteger(message.expectedRevision) || message.expectedRevision < 0) throw Error('Invalid skill revision.');
      const writerId = boundedText(message.writerId, 100, 'window ID');
      const value = normalizeSkills(message.value), json = JSON.stringify(value);
      const save = async () => {
        if (normalizeApiEndpoint(await readEndpoint()) !== endpoint) throw Error('Learning service settings changed. Skill records were not overwritten.');
        const before = (await api.storage.local.get(SKILLS_STORE_KEY))[SKILLS_STORE_KEY];
        const metadata = skillsMetadata(before), revision = metadata.skillsRevision;
        if (before && JSON.stringify(normalizeSkills(before.value)) === json) return { ok: true, endpoint, revision, writerId: metadata.skillsWriterId };
        if (revision !== message.expectedRevision) return { ok: false, conflict: true, endpoint, revision, writerId: metadata.skillsWriterId,
          error: 'Another Delta view updated your skills. Load the latest records first.' };
        await api.storage.local.set({ [SKILLS_STORE_KEY]: { revision: revision + 1, writerId, value } });
        return { ok: true, endpoint, revision: revision + 1, writerId };
      };
      const operation = stateWrites.then(save, save);
      stateWrites = operation.catch(() => {});
      return operation;
    }
    const key = `${LEARNING_STORE_PREFIX}${message.videoId}`;
    if (message.type === 'LEARNING_STATE_GET') {
      const saved = (await api.storage.local.get(key))[key];
      return { ok: true, value: saved?.endpoint === endpoint ? saved.value : null, endpoint, ...learningMetadata(saved, endpoint) };
    }
    if (message.type === 'LEARNING_STATE_SET') {
      const value = message.value;
      if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw Error('Invalid saved lesson format.');
      if (value?.profile) {
        if (!Array.isArray(value.profile.interests) || value.profile.interests.length > 5) throw Error('Choose up to five interests.');
        value.profile.interests.forEach((item) => boundedText(item, 80, 'interest'));
        if (value.profile.level != null && !['beginner', 'some-experience'].includes(value.profile.level) || value.profile.language != null && !['en', 'zh-HK'].includes(value.profile.language)) throw Error('Invalid learning preferences.');
      }
      if (value?.source) {
        const validatedSource = normalizeLearningPayload('generate', { source: { ...value.source, start: Number(value.source.start), end: Number(value.source.end) }, profile: { interests: [], level: 'beginner', language: 'en' } }).source;
        if (youtubeVideoId(validatedSource.videoUrl) !== message.videoId) throw Error('Source video does not match.');
      }
      if (value?.lessonToken) boundedText(value.lessonToken, 100_000, 'lesson token');
      if (value?.formula != null) boundedText(value.formula, 1000, 'formula', true);
      const json = JSON.stringify(value);
      if (json.length > MAX_STATE_BYTES) throw Error('Saved lesson is too large.');
      if (!Number.isSafeInteger(message.expectedRevision) || message.expectedRevision < 0) throw Error('Invalid lesson revision.');
      const writerId = boundedText(message.writerId, 100, 'window ID');
      const save = async () => {
        if (normalizeApiEndpoint(await readEndpoint()) !== endpoint) throw Error('Learning service settings changed. The previous lesson was not saved to the new service.');
        const before = (await api.storage.local.get(key))[key];
        const current = learningMetadata(before, endpoint);
        if (before?.endpoint === endpoint && JSON.stringify(before.value) === json) return { ok: true, endpoint, ...current };
        if (current.revision !== message.expectedRevision) return { ok: false, conflict: true, endpoint, ...current,
          error: 'Another Delta view updated this lesson. Reloading the latest progress.' };
        const revision = current.revision + 1;
        await api.storage.local.set({ [key]: { endpoint, revision, writerId, value: JSON.parse(json) } });
        return { ok: true, endpoint, revision, writerId };
      };
      const operation = stateWrites.then(save, save);
      stateWrites = operation.catch(() => {});
      return operation;
    }
    if (message.type !== 'LEARNING_REQUEST' || !Object.hasOwn(LEARNING_ROUTES, message.action)) throw Error('Unsupported learning action.');
    const payload = normalizeLearningPayload(message.action, message.payload);
    if (message.action === 'generate' && youtubeVideoId(payload.source.videoUrl) !== message.videoId) throw Error('Source video does not match.');
    if (!await api.permissions.contains({ origins: [endpointPermission(endpoint)] })) throw Error('Click “Create lesson” in the Delta native sidebar to allow the learning service, then return here.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 95_000);
    try {
      const response = await fetchImpl(`${endpoint}${LEARNING_ROUTES[message.action]}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
      if (!response.ok) {
        let detail = '';
        try { const body = await response.json(); const message = typeof body.error === 'string' ? body.error : body.error?.message || body.message;
          detail = typeof message === 'string' ? message.slice(0, 300) : ''; } catch {}
        throw Error(detail || `The learning service could not complete the request (HTTP ${response.status}).`);
      }
      if (message.action === 'pptx') {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 8_000_000) throw Error('The slide file is too large.');
        let binary = '';
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        if (normalizeApiEndpoint(await readEndpoint()) !== endpoint) throw Error('Learning service settings changed. The previous service file was not downloaded.');
        return { ok: true, result: { base64: btoa(binary), mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' } };
      }
      const resultText = await response.text();
      if (resultText.length > 250_000) throw Error('The lesson response is too large.');
      if (normalizeApiEndpoint(await readEndpoint()) !== endpoint) throw Error('Learning service settings changed. The previous service result was not applied.');
      return { ok: true, result: JSON.parse(resultText) };
    } catch (error) {
      if (error.name === 'AbortError') throw Error('Lesson creation timed out. Your watch history is saved. Try again.');
      throw error;
    } finally { clearTimeout(timer); }
  };
}
