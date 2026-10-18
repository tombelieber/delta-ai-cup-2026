import { LIVE_PREFIX, createRepository, applyRecording, isYouTubeUrl, validVideoId } from './store.js';
import { projectInPageView } from './in-page-view.js';
import { ANALYSIS_SETTINGS_KEY, ANALYSIS_RESULT_KEY, DEFAULT_API_ENDPOINT, normalizeApiEndpoint, endpointPermission,
  analysisPayload, savedAnalysisView, validateAnalysisResponse } from './analysis-client.js';
import { createLearningHandler, LEARNING_STORE_PREFIX, learningMetadata, SKILLS_STORE_KEY, skillsMetadata } from './learning-protocol.js';
import { createHistoryImportHandler } from './history-import.js';
import { createAccountHistoryHandler } from './account-history.js';
import { createLearningLibrary, learningEntryState, PANEL_INTENT_KEY } from './learning-library.js';
import { createHostedActionBroker } from './hosted-actions.js';

export const ANALYSIS_PREPARED_KEY = 'zhixin.analysis.prepared.v1';

export function installBackground(api, now = Date.now, fetchImpl = globalThis.fetch) {
  const repository = createRepository(api.storage.local, now);
  const panelSender = (sender) => sender.id === api.runtime.id && sender.url?.startsWith(api.runtime.getURL(''));
  const contentSender = (sender) => sender.id === api.runtime.id && Number.isInteger(sender.tab?.id) && sender.frameId === 0 && isYouTubeUrl(sender.url);
  const writeLive = async (tabId, live) => api.storage.session.set({ [`${LIVE_PREFIX}${tabId}`]: live });
  const readEndpoint = async () => {
    const settings = (await api.storage.local.get(ANALYSIS_SETTINGS_KEY))[ANALYSIS_SETTINGS_KEY];
    try { return normalizeApiEndpoint(settings?.endpoint || DEFAULT_API_ENDPOINT); } catch { return DEFAULT_API_ENDPOINT; }
  };
  const readAnalysis = async (data, endpoint) => savedAnalysisView((await api.storage.local.get(ANALYSIS_RESULT_KEY))[ANALYSIS_RESULT_KEY], data, endpoint);
  const readLearningContext = async (videoId) => {
    const learningEndpoint = await readEndpoint();
    const key = `${LEARNING_STORE_PREFIX}${videoId}`;
    const saved = validVideoId(videoId) ? (await api.storage.local.get(key))[key] : null;
    const metadata = learningMetadata(saved, learningEndpoint);
    const skills = (await api.storage.local.get(SKILLS_STORE_KEY))[SKILLS_STORE_KEY];
    return { learningEndpoint, learningRevision: metadata.revision, learningWriterId: metadata.writerId, ...skillsMetadata(skills), ...await learningEntryState(api.storage.local, videoId) };
  };
  const historyImport = createHistoryImportHandler({ api, panelSender, now });
  const accountHistory = createAccountHistoryHandler({ api, panelSender, now });
  const library = createLearningLibrary({ api, repository, readEndpoint, panelSender, contentSender, now });
  const handleLearning = createLearningHandler({ api, repository, readEndpoint, panelSender, contentSender, fetchImpl });
  const hostedActions = createHostedActionBroker({ api, readEndpoint, panelSender, now });
  async function handle(message, sender) {
    if (typeof message?.type === 'string' && message.type.startsWith('DELTA_HOSTED_ACTION_')) return hostedActions.handleInternal(message, sender);
    if (typeof message?.type === 'string' && message.type.startsWith('ACCOUNT_HISTORY_')) return accountHistory(message, sender);
    if (typeof message?.type === 'string' && message.type.startsWith('HISTORY_')) return historyImport(message, sender);
    if (message?.type === 'OPEN_LEARNING_PANEL') {
      if (!contentSender(sender) || !validVideoId(message.videoId) || new URL(sender.url).searchParams.get('v') !== message.videoId) throw Error('Open the matching YouTube video to start learning.');
      // Preserve the click gesture: open() is invoked before storage or any other await.
      const opened = api.sidePanel.open({ tabId: sender.tab.id });
      await opened;
      await api.storage.session.set({ [PANEL_INTENT_KEY]: { tabId: sender.tab.id, videoId: message.videoId, nonce: crypto.randomUUID(), at: now() } });
      return { ok: true };
    }
    if (message?.type === 'DISMISS_LEARNING_NUDGE') return library.dismiss(message.videoId, sender);
    if (message?.type === 'LEARNING_LIBRARY_GET') return library.list(sender);
    if (message?.type === 'LEARNING_LIBRARY_SAVE') return library.enrol(message.videoId, sender);
    if (typeof message?.type === 'string' && message.type.startsWith('LEARNING_')) return handleLearning(message, sender);
    if (message?.type === 'RECORDER_SAMPLE' && contentSender(sender)) {
      const sample = message.sample;
      if (!sample || (sample.videoId !== null && !validVideoId(sample.videoId))) throw Error('Invalid video ID.');
      const live = { videoId: sample.videoId, title: typeof sample.title === 'string' ? sample.title.slice(0, 300) : '',
        currentTime: Number.isFinite(sample.currentTime) ? Math.max(0, sample.currentTime) : 0,
        duration: Number.isFinite(sample.duration) ? sample.duration : 0,
        status: ['playing', 'paused', 'buffering', 'ad', 'seeking', 'waiting', 'unavailable'].includes(sample.status) ? sample.status : 'waiting', updatedAt: now(), error: '' };
      try {
        const data = await repository.update((before, timestamp) => sample.epoch === before.recordingEpoch ? applyRecording(before, sample, timestamp) : before);
        await writeLive(sender.tab.id, live);
        return { ok: true, enabled: data.recordingEnabled, epoch: data.recordingEpoch,
          view: { ...projectInPageView(data, live), ...await readLearningContext(live.videoId) } };
      } catch (error) {
        // The sidebar never presents an uncommitted interval as saved.
        await writeLive(sender.tab.id, { ...live, error: 'Could not save playback records. Please try again.' }).catch(() => {});
        return { ok: false, error: 'Could not save playback records. Please try again.' };
      }
    }
    if (!panelSender(sender)) throw Error('This action is not available from this page.');
    if (message?.type === 'GET_STATE') {
      const data = await repository.read();
      const key = `${LIVE_PREFIX}${message.tabId}`;
      const live = Number.isInteger(message.tabId) ? (await api.storage.session.get(key))[key] || null : null;
      const apiEndpoint = await readEndpoint();
      const intent = (await api.storage.session.get(PANEL_INTENT_KEY))[PANEL_INTENT_KEY];
      return { ok: true, data, live, error: live?.error || '', apiEndpoint, analysis: await readAnalysis(data, apiEndpoint),
        entryIntent: intent && intent.tabId === message.tabId && Number.isFinite(intent.at) && now() >= intent.at && now() - intent.at < 600_000 ? intent : null };
    }
    if (message?.type === 'SET_API_ENDPOINT') {
      const apiEndpoint = normalizeApiEndpoint(message.endpoint);
      await api.storage.local.set({ [ANALYSIS_SETTINGS_KEY]: { schemaVersion: 1, endpoint: apiEndpoint } });
      const data = await repository.read();
      return { ok: true, apiEndpoint, analysis: await readAnalysis(data, apiEndpoint) };
    }
    if (message?.type === 'PREPARE_ANALYSIS') {
      const endpoint = await readEndpoint();
      if (!await api.permissions.contains({ origins: [endpointPermission(endpoint)] })) throw Error('Allow access to the analysis service before continuing.');
      const payload = analysisPayload(await repository.read());
      const fingerprint = JSON.stringify(payload);
      const token = crypto.randomUUID();
      await api.storage.session.set({ [ANALYSIS_PREPARED_KEY]: { token, endpoint, fingerprint } });
      return { ok: true, token, endpoint, payload };
    }
    if (message?.type === 'SAVE_ANALYSIS') {
      const prepared = (await api.storage.session.get(ANALYSIS_PREPARED_KEY))[ANALYSIS_PREPARED_KEY];
      const endpoint = await readEndpoint();
      if (!prepared || prepared.token !== message.token || prepared.endpoint !== endpoint) throw Error('The analysis settings changed. Run the analysis again.');
      const result = validateAnalysisResponse(message.result, JSON.parse(prepared.fingerprint));
      const saved = { schemaVersion: 1, endpoint, fingerprint: prepared.fingerprint, result };
      await api.storage.local.set({ [ANALYSIS_RESULT_KEY]: saved });
      await api.storage.session.remove(ANALYSIS_PREPARED_KEY);
      const data = await repository.read();
      return { ok: true, analysis: savedAnalysisView(saved, data, endpoint) };
    }
    if (message?.type === 'SET_RECORDING') {
      if (typeof message.enabled !== 'boolean') throw Error('Invalid recording setting.');
      const data = await repository.update((before) => before.recordingEnabled === message.enabled ? before
        : ({ ...before, recordingEnabled: message.enabled, recordingEpoch: before.recordingEpoch + 1 }));
      return { ok: true, data };
    }
    if (message?.type === 'SET_GOAL') {
      if (typeof message.goal !== 'string' || message.goal.length > 200) throw Error('Use a goal of up to 200 characters.');
      const data = await repository.update((before) => ({ ...before, goal: message.goal.trim() }));
      return { ok: true, data };
    }
    if (message?.type === 'OPEN_VIDEO') {
      if (!validVideoId(message.videoId) || !Number.isFinite(message.time) || message.time < 0) throw Error('Invalid video position.');
      await api.tabs.create({ url: `https://www.youtube.com/watch?v=${message.videoId}&t=${Math.floor(message.time)}s` });
      return { ok: true };
    }
    throw Error('This action is not supported.');
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    handle(message, sender).then(respond, (error) => respond({ ok: false, error: (panelSender(sender) || contentSender(sender))
      ? String(error.message || 'Delta could not complete this action. Please try again.').slice(0, 350) : 'This action is not available from this page.' }));
    return true;
  });
  api.runtime.onMessageExternal?.addListener((message, sender, respond) => {
    hostedActions.handleExternal(message, sender).then(respond, () => respond({ ok: false, error: 'Open this action again from the Delta extension.' }));
    return true;
  });
  const configureTab = (id, url) => api.sidePanel.setOptions({ tabId: id, path: 'panel.html', enabled: isYouTubeUrl(url) }).catch(() => {});
  const initialise = async () => {
    await api.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
    await api.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
    await api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    for (const tab of await api.tabs.query({})) await configureTab(tab.id, tab.url);
  };
  api.runtime.onInstalled.addListener(() => { initialise().catch(() => {}); });
  api.runtime.onStartup.addListener(() => { initialise().catch(() => {}); });
  api.tabs.onUpdated.addListener((id, change, tab) => { if (change.url || change.status === 'complete') configureTab(id, tab.url); if (change.url) accountHistory.handleTabUpdated?.(id, change.url).catch(() => {}); });
  api.tabs.onRemoved.addListener((id) => { api.storage.session.remove(`${LIVE_PREFIX}${id}`).catch(() => {}); accountHistory.handleTabRemoved?.(id).catch(() => {}); hostedActions.handleTabRemoved(id).catch(() => {}); });
  return { handle, repository, initialise };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id) installBackground(chrome);
