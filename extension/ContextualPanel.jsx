import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LearningWorkspace } from '../src/learning/LiveLearningApp.jsx';
import { LEARNING_PILOT, learningSourceVideo } from './learning-source.js';
import { canOfferLearning } from './contextual-learning.js';
import { DEFAULT_API_ENDPOINT, normalizeApiEndpoint } from './analysis-client.js';
import { openHostedAction } from './hosted-action-client.js';
import { formatTime, watchedSeconds } from '../src/assistant-data.js';
import HistoryImport from './HistoryImport.jsx';
import YouTubeHistoryImport from './YouTubeHistoryImport.jsx';
import { LearningHistory } from './LearningJournal.jsx';
import PersonalUniverse from './PersonalUniverse.jsx';
import './contextual-panel.css';

const savedLegacy = (items, videoId) => videoId === LEARNING_PILOT.videoId && items.some(item => item.videoId === videoId && item.hasLesson === true);
export function learningServiceEndpoint(value) {
  const endpoint = normalizeApiEndpoint(value), url = new URL(endpoint);
  if (endpoint !== DEFAULT_API_ENDPOINT && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('Use the hosted Delta service or a localhost HTTP development service.');
  return endpoint;
}
export function SavedLearningWorkspace({ items, videoId, source, client, storage, onExitLesson }) {
  const savedClient = useMemo(() => ({ ...client, generationPaused: true }), [client]);
  if (!savedLegacy(items, videoId)) return null;
  return <LearningWorkspace compact embedded entryView="lesson" sourceVideo={source} client={savedClient} storage={storage} onExitLesson={onExitLesson} />;
}
function LearningEntry({ videoId, title, busy, status, onLearn }) {
  return <aside className="dcp-current-offer"><span className="dcp-eyebrow">LEARN WITH DELTA</span><h2>{canOfferLearning(videoId) ? title || 'Your current YouTube video' : 'Open a YouTube video to begin.'}</h2><p>Use this video's captions to create a lesson, practice and source-linked answers. Google sign-in opens on the Delta website with US$0.50 lifetime AI allowance.</p>{canOfferLearning(videoId) ? <button className="dcp-primary" type="button" disabled={busy} onClick={() => onLearn(videoId)}>{busy ? status === 'opening' ? 'Opening Delta…' : 'Reading this video’s captions…' : 'Learn current video →'}</button> : <p className="dcp-note">Choose a YouTube watch page, then open Delta. Caption availability is checked when you choose Learn.</p>}<p className="dcp-note">Only this video's selected caption excerpt is shared for learning. Missing captions are shown clearly; playback history stays here.</p></aside>;
}
const emptyJournal = () => ({ entries: [], groups: [], summary: { videos: 0, watched: 0, imported: 0, learning: 0, checkedTasks: 0 } });
const sourceFor = (videoId, data) => learningSourceVideo({ videoId, url: `https://www.youtube.com/watch?v=${videoId}`,
  title: data?.videos?.[videoId]?.title || (videoId === LEARNING_PILOT.videoId ? 'How to use SUMIF and SUMIFS in Microsoft Excel' : 'YouTube video'), watchedRanges: data?.videos?.[videoId]?.ranges || [] });
const message = failure => /[\u4e00-\u9fff]/.test(failure?.message || '') ? 'Delta could not complete this step. Your saved work is kept. Please try again.' : failure?.message || 'Could not complete this step. Please try again.';

export default function ContextualPanel({ data, live, error, learningClient, learningStorage, historyClient, accountHistoryClient, libraryClient, lessonVideoId,
  mapClient, entryIntent, onSelectVideo, onToggleRecording, onGoalChange, onOpenVideo, onRetry, apiEndpoint, onEndpointChange, recordsRevision = 0 }) {
  const [view, setView] = useState('library');
  const [journalTimeRange, setJournalTimeRange] = useState('all');
  const [items, setItems] = useState([]);
  const [journal, setJournal] = useState(emptyJournal);
  const [journalEndpoint, setJournalEndpoint] = useState('');
  const [libraryError, setLibraryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [captureStatus, setCaptureStatus] = useState(''), [notice, setNotice] = useState('');
  const [hostedVideoId, setHostedVideoId] = useState(''), [hostedError, setHostedError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [endpoint, setEndpoint] = useState(apiEndpoint);
  const [goal, setGoal] = useState(data?.goal || '');
  const heading = useRef(null), operation = useRef(0), intent = useRef(''), running = useRef(false), hostedController = useRef(null);
  const source = sourceFor(lessonVideoId, data);

  useEffect(() => { setEndpoint(apiEndpoint); }, [apiEndpoint]);
  useEffect(() => {
    if (!entryIntent?.nonce || intent.current === entryIntent.nonce) return;
    intent.current = entryIntent.nonce;
    if (!canOfferLearning(entryIntent.videoId)) return;
    void beginHostedLesson(entryIntent.videoId, { tabId: entryIntent.tabId });
  }, [entryIntent?.nonce]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const response = await libraryClient.list();
        if (active) {
          if (response.endpoint !== apiEndpoint) { setJournalEndpoint(''); setLibraryError('The learning service changed. Retry to refresh your records.'); return; }
          setItems(response.items || []); setJournal(response.journal || emptyJournal()); setJournalEndpoint(apiEndpoint); setLibraryError('');
        }
      }
      catch (failure) { if (active) setLibraryError(message(failure)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [libraryClient, view, refresh, recordsRevision, apiEndpoint]);
  useEffect(() => { heading.current?.focus(); }, [view]);
  useEffect(() => () => { operation.current += 1; hostedController.current?.abort(); }, []);
  async function beginHostedLesson(videoId = live?.videoId, { tabId } = {}) {
    if (!canOfferLearning(videoId) || running.current) return;
    const serial = ++operation.current, controller = new AbortController();
    running.current = true; hostedController.current = controller;
    setBusy(true); setHostedError(''); setNotice(''); setHostedVideoId(videoId); setView('study'); setCaptureStatus('capturing'); onSelectVideo(videoId);
    try {
      learningServiceEndpoint(apiEndpoint);
      await openHostedAction({ action: 'learn', videoId, ...(Number.isInteger(tabId) ? { tabId } : {}), endpoint: apiEndpoint, signal: controller.signal,
        onStatus: status => { if (serial === operation.current) setCaptureStatus(status); } });
      if (serial === operation.current) setNotice('Delta opened this video on the learning website. Sign in with Google and review its caption availability there. Playback history stays in this extension.');
    } catch (failure) { if (serial === operation.current) setHostedError(message(failure)); }
    finally { if (serial === operation.current) { running.current = false; setBusy(false); } if (hostedController.current === controller) hostedController.current = null; }
  }
  async function learn(videoId = live?.videoId) {
    if (!canOfferLearning(videoId) || running.current) return;
    if (journalEndpoint === apiEndpoint && savedLegacy(items, videoId)) { onSelectVideo(videoId); setView('lesson'); return; }
    await beginHostedLesson(videoId);
  }
  async function run(callback) {
    if (running.current) return;
    const serial = ++operation.current;
    running.current = true; setBusy(true); setLibraryError('');
    try { await callback(); } catch (failure) { if (serial === operation.current) setLibraryError(message(failure)); }
    finally { if (serial === operation.current) { running.current = false; setBusy(false); } }
  }
  function navigate(next) { operation.current += 1; hostedController.current?.abort(); running.current = false; setBusy(false); setNotice(''); setHostedError(''); setHostedVideoId(''); if (next === 'lesson' && journalEndpoint === apiEndpoint && savedLegacy(items, LEARNING_PILOT.videoId)) onSelectVideo(LEARNING_PILOT.videoId); setView(next); }
  const currentJournal = journalEndpoint === apiEndpoint ? journal : emptyJournal();
  const currentItems = journalEndpoint === apiEndpoint ? items : [];
  const currentVideoId = canOfferLearning(live?.videoId) ? live.videoId : canOfferLearning(lessonVideoId) ? lessonVideoId : '';
  const entryVideoId = view === 'study' && canOfferLearning(hostedVideoId) ? hostedVideoId : currentVideoId;
  const currentTitle = live?.videoId === entryVideoId ? live.title : data?.videos?.[entryVideoId]?.title || currentJournal.entries?.find(entry => entry.videoId === entryVideoId)?.title;
  let unsupportedEndpoint = false; try { learningServiceEndpoint(apiEndpoint); } catch { unsupportedEndpoint = true; }
  const learningEntry = <LearningEntry videoId={entryVideoId} title={currentTitle} busy={busy} status={captureStatus} onLearn={beginHostedLesson} />;
  return <main className="delta-context-panel" lang="en">
    <header className="dcp-header"><span className="dcp-logo" aria-hidden="true">▲</span><div><strong>Delta</strong><span>Learn it. Keep it.</span></div></header>
    <nav className="dcp-nav" aria-label="Delta sections">{[['library','History'],['tree','My map'],['lesson','Saved lesson'],['study','Learning lab']].map(([key,label]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => navigate(key)}>{label}</button>)}</nav>
    <div className="dcp-content">
      {unsupportedEndpoint && <section className="dcp-error" role="alert"><p>This saved service is outside the supported production and local development hosts. Your setting has been kept.</p><button type="button" disabled={busy} onClick={() => void run(() => onEndpointChange(DEFAULT_API_ENDPOINT))}>Use hosted Delta service</button></section>}
      {notice && <p className="dcp-note" role="status">{notice}</p>}
      {(hostedError || libraryError || error) && <section className="dcp-error" role="alert"><p>{hostedError || libraryError || message({message:error})}</p><button type="button" onClick={() => { setRefresh(n => n + 1); void onRetry(); }}>Retry</button></section>}
      {view !== 'tree' && view !== 'study' && <h1 className="dcp-title" ref={heading} tabIndex={-1}>{view === 'library' ? 'Your history' : 'Your saved lesson'}</h1>}
      {view === 'study' && learningEntry}
      {view === 'library' && <section aria-label="Your history">
        {loading && <p role="status" className="dcp-note">Updating your history…</p>}
        <YouTubeHistoryImport client={accountHistoryClient} onImported={() => setRefresh(n => n + 1)} />
        <LearningHistory journal={currentJournal} timeRange={journalTimeRange} onTimeRangeChange={setJournalTimeRange} busy={busy} onLearn={learn} onShowMap={() => navigate('tree')} />
        {learningEntry}
        <details className="dcp-tools"><summary>Import Chrome page visits instead</summary><HistoryImport client={historyClient} onContinue={() => navigate('library')} /></details>
        <p className="dcp-note">Saved in this Chrome profile. Website and extension records do not sync through an account.</p>
      </section>}
      {view === 'lesson' && (savedLegacy(currentItems, lessonVideoId) ? <><p className="dcp-note">Your existing SUMIF lesson, checked practice and PowerPoint remain available here. Create new lessons on the signed-in website.</p><SavedLearningWorkspace items={currentItems} videoId={lessonVideoId} key={`${lessonVideoId}:${apiEndpoint}`} source={source} client={learningClient} storage={learningStorage} onExitLesson={() => navigate('tree')} />{learningEntry}</> : <><p className="dcp-note">No saved SUMIF lesson is available in this view. New lessons use your Google account credit on the learning website.</p>{learningEntry}</>)}
      {view === 'tree' && <section aria-label="Your personal learning map">{loading && <p role="status" className="dcp-note">Updating your map…</p>}<PersonalUniverse journal={currentJournal} mapClient={mapClient} timeRange={journalTimeRange} onTimeRangeChange={setJournalTimeRange} busy={busy} onLearn={learn} /></section>}
      <details className="dcp-tools"><summary>Watching records & settings</summary>
        <label className="dcp-toggle"><span>Record actual playback<small>Skipped parts do not count. Existing progress is kept.</small></span><input type="checkbox" checked={data?.recordingEnabled !== false} disabled={busy} onChange={event => { const enabled = event.target.checked; void run(() => onToggleRecording(enabled)); }} /></label>
        {live?.videoId && <p className="dcp-note">Current video: {live.title || 'YouTube video'}<br />Recorded playback: {formatTime(watchedSeconds(data?.videos?.[live.videoId]?.ranges || []))}</p>}
        <button type="button" onClick={() => navigate('library')}>View your history</button>
        <p className="dcp-note">Playback ranges do not prove understanding or a completed skill. Imported visits are kept separately.</p>
        <details><summary>Goal & advanced development settings</summary><form onSubmit={event => { event.preventDefault(); void run(() => onGoalChange(goal)); }}><label>Learning goal · optional<input value={goal} maxLength={200} onChange={event => setGoal(event.target.value)} /></label><button type="submit" disabled={busy}>Save goal</button></form><form onSubmit={event => { event.preventDefault(); void run(() => onEndpointChange(learningServiceEndpoint(endpoint))); }}><label>Advanced development service URL<input type="url" value={endpoint} onChange={event => setEndpoint(event.target.value)} required /></label><button type="submit" disabled={busy}>Save service URL</button></form></details>
      </details>
    </div><footer className="dcp-footer">Only checked practice earns completion marks.</footer>
  </main>;
}
