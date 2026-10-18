import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Sidebar from './ContextualPanel.jsx';
import { emptyData, STORE_KEY, LIVE_PREFIX } from './store.js';
import { ANALYSIS_SETTINGS_KEY, ANALYSIS_RESULT_KEY, DEFAULT_API_ENDPOINT, normalizeApiEndpoint, endpointPermission, fetchAnalysis } from './analysis-client.js';
import { createExtensionLearningAdapter } from './learning-client.js';
import { LEARNING_STORE_PREFIX, SKILLS_STORE_KEY } from './learning-protocol.js';
import { createHistoryClient } from './history-client.js';
import { LEARNING_LIBRARY_KEY, PANEL_INTENT_KEY } from './learning-library.js';
import { HISTORY_IMPORT_KEY } from './history-import.js';
import { ACCOUNT_HISTORY_KEY } from './account-history.js';
import { createAccountHistoryClient } from './account-history-client.js';
import { createMapPanelController } from './map-panel-controller.js';
import { MAP_CLASSIFICATION_KEY } from './map-model.js';

function Panel() {
  const [state, setState] = useState({ data: emptyData(), live: null, error: '', loading: true });
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [recordsRevision, setRecordsRevision] = useState(0);
  const historyClient = useMemo(() => createHistoryClient({ runtime: chrome.runtime, permissions: chrome.permissions }), []);
  const accountHistoryClient = useMemo(() => createAccountHistoryClient({ runtime: chrome.runtime }), []);
  const libraryClient = useMemo(() => ({ list: () => request({ type: 'LEARNING_LIBRARY_GET' }), save: (videoId) => request({ type: 'LEARNING_LIBRARY_SAVE', videoId }) }), []);
  const endpointRef = useRef(state.apiEndpoint || DEFAULT_API_ENDPOINT);
  endpointRef.current = state.apiEndpoint || DEFAULT_API_ENDPOINT;
  const mapClient = useMemo(() => createMapPanelController({ storage: chrome.storage.local, permissions: chrome.permissions,
    libraryClient, readEndpoint: () => endpointRef.current }), [libraryClient]);
  const analysisController = useRef(null);
  const effectiveVideoId = selectedVideoId || state.entryIntent?.videoId || state.live?.videoId || '';
  const learning = useMemo(() => createExtensionLearningAdapter({ runtime: chrome.runtime, permissions: chrome.permissions,
    videoId: effectiveVideoId, endpoint: state.apiEndpoint || DEFAULT_API_ENDPOINT }), [effectiveVideoId, state.apiEndpoint]);
  const learningRef = useRef(learning);
  learningRef.current = learning;
  async function request(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw Error(response?.error || 'Delta disconnected. Please reload the extension.');
    return response;
  }
  async function refresh() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await request({ type: 'GET_STATE', tabId: tab?.id });
      setState({ ...response, loading: false });
    } catch (error) { setState((before) => ({ ...before, loading: false, error: error.message })); }
  }
  useEffect(() => {
    let mounted = true;
    const update = () => { if (mounted) void refresh(); };
    const storageChanged = (changes, area) => {
      if (area === 'local' && Object.keys(changes).some(key => [STORE_KEY, LEARNING_LIBRARY_KEY, HISTORY_IMPORT_KEY, ACCOUNT_HISTORY_KEY, SKILLS_STORE_KEY, MAP_CLASSIFICATION_KEY].includes(key) || key.startsWith(LEARNING_STORE_PREFIX))) setRecordsRevision(value => value + 1);
      if (area === 'local') for (const [key, change] of Object.entries(changes)) {
        if (key === SKILLS_STORE_KEY && change.newValue) learningRef.current.observeContext({ skillsRevision: change.newValue.revision, skillsWriterId: change.newValue.writerId });
        if (key.startsWith(LEARNING_STORE_PREFIX) && change.newValue) learningRef.current.observeContext({ videoId: key.slice(LEARNING_STORE_PREFIX.length),
          learningEndpoint: change.newValue.endpoint, learningRevision: change.newValue.revision || 0, learningWriterId: change.newValue.writerId || '' });
      }
      if (area === 'local' && [STORE_KEY, ANALYSIS_SETTINGS_KEY, ANALYSIS_RESULT_KEY, LEARNING_LIBRARY_KEY].some((key) => changes[key]) || area === 'session' && Object.keys(changes).some((key) => key.startsWith(LIVE_PREFIX) || key === PANEL_INTENT_KEY)) update();
    };
    chrome.storage.onChanged.addListener(storageChanged);
    chrome.tabs.onActivated.addListener(update);
    chrome.tabs.onUpdated.addListener(update);
    update();
    return () => { mounted = false; analysisController.current?.abort(); mapClient.destroy(); chrome.storage.onChanged.removeListener(storageChanged); chrome.tabs.onActivated.removeListener(update); chrome.tabs.onUpdated.removeListener(update); };
  }, []);
  async function mutate(message) {
    try { const response = await request(message); setState((before) => ({ ...before, data: response.data || before.data, error: '' })); }
    catch (error) { setState((before) => ({ ...before, error: error.message })); throw error; }
  }
  async function changeEndpoint(value) {
    const endpoint = normalizeApiEndpoint(value);
    const response = await request({ type: 'SET_API_ENDPOINT', endpoint });
    setState((before) => ({ ...before, apiEndpoint: response.apiEndpoint, analysis: response.analysis }));
    setAnalysisError('');
  }
  async function analyze() {
    if (analysisController.current) return;
    const controller = new AbortController();
    analysisController.current = controller;
    setAnalysisBusy(true); setAnalysisError('');
    try {
      const endpoint = state.apiEndpoint || DEFAULT_API_ENDPOINT;
      // Called directly from the native button gesture. Grant this single host;
      // optional permissions are never requested at install or while recording.
      const allowed = await chrome.permissions.request({ origins: [endpointPermission(endpoint)] });
      if (!allowed) throw Error('Analysis service access was declined. Playback records stay on this device.');
      const prepared = await request({ type: 'PREPARE_ANALYSIS' });
      const result = await fetchAnalysis(prepared.endpoint, prepared.payload, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const response = await request({ type: 'SAVE_ANALYSIS', token: prepared.token, result });
      setState((before) => ({ ...before, analysis: response.analysis }));
    } catch (error) { setAnalysisError(error.message || 'Could not complete the analysis. Playback records are kept.'); }
    finally { analysisController.current = null; setAnalysisBusy(false); }
  }
  if (state.loading) return <p role="status" style={{ padding: 24 }}>Loading your local Delta records…</p>;
  return <Sidebar data={state.data} live={state.live} error={state.error} onRetry={refresh}
    learningClient={learning.client} learningStorage={learning.storage}
    historyClient={historyClient} accountHistoryClient={accountHistoryClient} libraryClient={libraryClient} mapClient={mapClient} entryIntent={state.entryIntent}
    lessonVideoId={effectiveVideoId} onSelectVideo={setSelectedVideoId} recordsRevision={recordsRevision}
    analysis={state.analysis || null} analysisBusy={analysisBusy} analysisError={analysisError}
    apiEndpoint={state.apiEndpoint || DEFAULT_API_ENDPOINT} onAnalyze={analyze} onCancelAnalyze={() => analysisController.current?.abort()} onEndpointChange={changeEndpoint}
    onToggleRecording={(enabled) => mutate({ type: 'SET_RECORDING', enabled })}
    onGoalChange={(goal) => mutate({ type: 'SET_GOAL', goal })}
    onOpenVideo={async (videoId, time = 0) => { try { await request({ type: 'OPEN_VIDEO', videoId, time }); } catch (error) { setState((before) => ({ ...before, error: error.message })); } }} />;
}
createRoot(document.getElementById('root')).render(<Panel />);
