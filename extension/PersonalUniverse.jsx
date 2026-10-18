import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildPersonalMap, mapPathId } from './map-model.js';
import { JOURNAL_TIME_RANGES } from './journal-view.js';
import { TimeRange, VideoRecord } from './LearningJournal.jsx';
import ShareUniverse from './ShareUniverse.jsx';
import { createMapReviewExport, downloadMapReviewExport } from './map-review-export.js';
import './personal-universe.css';

const count = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const quantity = (value, noun) => `${count(value).toLocaleString('en')} ${count(value) === 1 ? noun : `${noun}s`}`;
const compact = value => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(count(value));
const issueText = error => error?.name === 'MapAnalysisError' && typeof error.message === 'string'
  ? error.message : 'Map analysis is unavailable. Your records and saved results are kept.';
const initialSnapshot = { classifications: null, status: { state: 'idle', processed: 0, pending: 0, unresolved: 0, total: 0 }, accessMode: 'unknown', accessConfigured: false };
const PALETTE = ['#d7b9eb', '#b6cedd', '#d4bddb', '#b8c2e7', '#d9c7ae', '#c4b1e5'];
const POINTS = [[200, 70], [322, 140], [322, 288], [200, 358], [78, 288], [78, 140]];
const FALLBACK_ID = mapPathId(['More to explore']);
const isFallback = node => node.id === FALLBACK_ID || node.id.startsWith(`${FALLBACK_ID}/`);
function lastActive(value) { return value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value)) : 'Date unknown'; }

function OrbitalTopics({ node, root, page, onPage, onOpen, rangeLabel }) {
  const pages = Math.max(1, Math.ceil(node.children.length / 6)), current = Math.min(page, pages - 1);
  const items = node.children.slice(current * 6, current * 6 + 6), first = node.children.length ? current * 6 + 1 : 0, last = Math.min((current + 1) * 6, node.children.length);
  const kind = root ? 'topics' : 'subtopics';
  return <div className="dpu-universe">
    <div className="dpu-universe-top"><strong>{quantity(node.count, 'video')}</strong><span>{rangeLabel}</span></div>
    {pages > 1 && <nav className="dpu-pager" aria-label={`Browse ${kind}`}><button type="button" disabled={current === 0} onClick={() => onPage(current - 1)}>← Previous</button><span role="status">{first}–{last} of {node.children.length}</span><button type="button" disabled={current === pages - 1} onClick={() => onPage(current + 1)}>Next {kind} →</button></nav>}
    <div className="dpu-orbit-stage"><svg viewBox="0 0 400 420" aria-hidden="true" focusable="false"><g fill="none" stroke="#d4b5f1" opacity=".11"><ellipse cx="200" cy="210" rx="165" ry="180" /><ellipse cx="200" cy="210" rx="139" ry="146" /><circle cx="200" cy="210" r="78" /></g>{Array.from({ length: 40 }, (_, index) => <circle key={index} cx={15 + index * 83 % 370} cy={14 + index * 137 % 391} r={index % 7 ? .55 : 1} fill="#d7c0ed" opacity=".26" />)}{items.map((item, index) => { const [x, y] = POINTS[index]; return <path key={item.id} d={`M200 210 Q${200 + (x - 200) * .3} ${y} ${x} ${y}`} fill="none" stroke={PALETTE[index]} opacity=".18" />; })}</svg>
      <div className="dpu-center" aria-label={`${quantity(node.count, 'video')} in ${root ? 'your history' : node.label}`}><strong>{compact(node.count)}</strong><span>{root ? 'YOU' : 'VIDEOS'}</span></div>
      {items.map((item, index) => <button type="button" key={item.id} className={`dpu-planet${item.unresolved ? ' dpu-unresolved' : ''}`} style={{ left: `${POINTS[index][0] / 4}%`, top: `${POINTS[index][1] / 4.2}%`, '--dpu-color': PALETTE[index] }} onClick={() => onOpen(item)} aria-label={`${item.label}, ${quantity(item.count, 'video')}. Open ${item.children.length ? 'topic' : 'videos'}.`}><strong>{compact(item.count)}</strong><span>{item.label}</span></button>)}
    </div><p className="dpu-caption">{node.children.length ? `${kind[0].toUpperCase() + kind.slice(1)} ${first}–${last} of ${node.children.length}. Open a planet, or explore every topic below.` : 'Your topics will appear here as videos are grouped.'}</p>
  </div>;
}

export default function PersonalUniverse({ journal, mapClient, timeRange = 'all', onTimeRangeChange, busy = false, onLearn, surface = 'extension' }) {
  const id = useId(), heading = useRef(null), mounted = useRef(false), refreshVersion = useRef(0), runVersion = useRef(0), runningRef = useRef(false);
  const [snapshot, setSnapshot] = useState(initialSnapshot), [snapshotReady, setSnapshotReady] = useState(false), [path, setPath] = useState([]);
  const [sort, setSort] = useState('balanced'), [page, setPage] = useState(0), [query, setQuery] = useState(''), [limit, setLimit] = useState(12), [navigation, setNavigation] = useState(0);
  const [running, setRunning] = useState(false), [localError, setLocalError] = useState(''), [notice, setNotice] = useState('');
  const [accessCode, setAccessCode] = useState(''), [savingAccess, setSavingAccess] = useState(false), [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const entries = journal?.entries || [];
  function applySnapshot(value) { if (mounted.current && value?.classifications && value?.status) { setSnapshot(value); setSnapshotReady(true); } }
  async function refreshSnapshot() {
    if (!mapClient) return;
    const version = ++refreshVersion.current;
    try { const value = await mapClient.get(); if (mounted.current && version === refreshVersion.current) applySnapshot(value); }
    catch (error) { if (mounted.current && version === refreshVersion.current) setLocalError(issueText(error)); }
  }
  useEffect(() => {
    mounted.current = true;
    heading.current?.focus();
    const unsubscribe = mapClient?.subscribe?.(() => { void refreshSnapshot(); });
    void refreshSnapshot();
    return () => { mounted.current = false; refreshVersion.current++; runVersion.current++; if (runningRef.current) mapClient?.cancel(); runningRef.current = false; unsubscribe?.(); };
  }, [mapClient]);
  useEffect(() => { if (mounted.current) void refreshSnapshot(); }, [journal]);
  useEffect(() => { setLimit(12); setPage(0); }, [timeRange, sort, path]);
  useEffect(() => { if (navigation) heading.current?.focus(); }, [navigation]);

  const model = useMemo(() => buildPersonalMap(entries, { classifications: snapshot.classifications, range: timeRange, sort }), [journal, snapshot.classifications, timeRange, sort]);
  const fullModel = useMemo(() => timeRange === 'all' ? model : buildPersonalMap(entries, { classifications: snapshot.classifications, sort }), [journal, snapshot.classifications, timeRange, sort, model]);
  const node = useMemo(() => {
    if (!path.length) return model;
    const nodeId = mapPathId(path), found = model.nodes.find(item => item.id === nodeId);
    return found || { ...(fullModel.nodes.find(item => item.id === nodeId) || { id: nodeId, path, label: path.at(-1) }), count: 0, children: [], records: [], directRecords: [], lastActive: null, recentCount: 0 };
  }, [model, fullModel, path]);
  const root = !path.length, search = query.trim().toLocaleLowerCase('en'), fallbackView = isFallback(node);
  const fallback = root ? model.children.find(item => item.id === FALLBACK_ID) : null;
  const children = root ? node.children.filter(item => item.id !== FALLBACK_ID) : fallbackView ? [] : node.children;
  const leaf = !root && !children.length, orbitNode = { ...node, children };
  const topicRows = search ? model.nodes.filter(item => !isFallback(item) && item.path.length > path.length && path.every((label, index) => item.path[index] === label) && item.label.toLocaleLowerCase('en').includes(search)) : children;
  const videoRows = (search || leaf ? node.records : node.directRecords).filter(entry => !search || [entry.title, entry.channel].some(value => String(value || '').toLocaleLowerCase('en').includes(search)));
  const rangeLabel = JOURNAL_TIME_RANGES.find(range => range.id === timeRange)?.label || 'All time';
  const status = snapshot.status || initialSnapshot.status, total = snapshotReady ? count(status.total) : entries.length, processed = count(status.processed), reviewed = Number.isFinite(status.reviewed) ? count(status.reviewed) : processed, pending = count(status.pending), unresolved = snapshotReady ? count(status.unresolved) : model.unresolved;
  const hostedAnalysis = snapshot.accessMode === 'google', website = surface === 'web';
  const analysisError = localError || status.error || '', canAnalyze = Boolean(mapClient && snapshotReady && (hostedAnalysis || snapshot.accessConfigured) && total && pending > 0);
  function openNode(item) { setPath([...item.path]); setQuery(''); setLimit(12); setPage(0); setNavigation(value => value + 1); }
  function goTo(depth) { setPath(value => value.slice(0, depth)); setQuery(''); setLimit(12); setPage(0); setNavigation(value => value + 1); }

  // begin() must run in this click's synchronous turn, before any awaited read.
  function analyzeNewVideos() {
    if (runningRef.current || !mapClient) return;
    let beginning;
    try { beginning = mapClient.begin(); }
    catch (error) { setLocalError(issueText(error)); return; }
    const version = ++runVersion.current; runningRef.current = true; setRunning(true); setLocalError(''); setNotice('');
    async function run() {
      try {
        let next = await beginning;
        if (!mounted.current || version !== runVersion.current) return;
        applySnapshot(next);
        while (count(next.status?.pending) > 0 && mounted.current && version === runVersion.current) {
          next = await mapClient.classifyNext();
          if (!mounted.current || version !== runVersion.current) return;
          applySnapshot(next);
          if (!next.batch?.submitted) break;
        }
        if (mounted.current && version === runVersion.current) setNotice(count(next.status?.unresolved) ? 'Available batches are saved. Some videos still need more context.' : 'Your map is up to date.');
      } catch (error) { if (mounted.current && version === runVersion.current) setLocalError(issueText(error)); }
      finally { if (version === runVersion.current) { runningRef.current = false; if (mounted.current) setRunning(false); } }
    }
    void run();
  }
  function stopAnalysis() { runVersion.current++; runningRef.current = false; mapClient?.cancel(); setRunning(false); setNotice('Analysis paused. Saved results are kept.'); }
  async function saveAccess(event) {
    event.preventDefault(); if (!mapClient || savingAccess) return;
    setSavingAccess(true); setLocalError(''); setNotice('');
    try { const result = await mapClient.setAccessToken(accessCode.trim()); applySnapshot(result); setAccessCode(''); setNotice('Private access saved on this device.'); }
    catch (error) { setLocalError(issueText(error)); }
    finally { if (mounted.current) setSavingAccess(false); }
  }
  async function importMap(event) {
    const input = event.currentTarget, file = input.files?.[0]; if (!file || !mapClient) return;
    setImporting(true); setLocalError(''); setNotice('');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('FILE_TOO_LARGE');
      const value = JSON.parse(await file.text());
      if (!value || value.schemaVersion !== 1 || !value.assignments || typeof value.assignments !== 'object' || Array.isArray(value.assignments)) throw new Error('INVALID_FILE');
      const result = await mapClient.importResults({ schemaVersion: value.schemaVersion, assignments: value.assignments, ...(Object.hasOwn(value, 'reviews') ? { reviews: value.reviews } : {}), updatedAt: value.updatedAt });
      applySnapshot(result); setNotice('Saved map classifications imported. Your video history is unchanged.');
    } catch (error) { setLocalError(error?.name === 'MapAnalysisError' ? issueText(error) : 'Choose a valid Delta map classification backup. Nothing was imported.'); }
    finally { input.value = ''; if (mounted.current) setImporting(false); }
  }
  function exportMapReview() {
    if (!journal || exporting) return;
    setExporting(true); setLocalError(''); setNotice('');
    try {
      const review = createMapReviewExport(journal, { classifications: snapshot.classifications });
      downloadMapReviewExport(review);
      setNotice(`Private map review ready to save · ${quantity(review.records.length, 'video')}. Keep the JSON file private.`);
    } catch { setLocalError('The private map review could not be prepared. Your saved records were not changed.'); }
    finally { setExporting(false); }
  }

  return <section className="delta-learning-journal dpu-map" aria-label="Your personal map">
    {path.length > 0 && <nav className="dpu-breadcrumbs" aria-label="Map location"><button type="button" onClick={() => goTo(path.length - 1)}>← Back</button><button type="button" onClick={() => goTo(0)}>My map</button>{path.map((label, index) => <React.Fragment key={`${label}-${index}`}><span aria-hidden="true">/</span>{index === path.length - 1 ? <span aria-current="page">{mapPathId(path.slice(0, index + 1)) === FALLBACK_ID ? 'Not yet grouped' : label}</span> : <button type="button" onClick={() => goTo(index + 1)}>{mapPathId(path.slice(0, index + 1)) === FALLBACK_ID ? 'Not yet grouped' : label}</button>}</React.Fragment>)}</nav>}
    <header className="dpu-heading"><p className="dpu-eyebrow">{root ? 'Your interests, connected' : children.length ? 'Follow your curiosity' : 'Your history, up close'}</p><h1 ref={heading} tabIndex={-1}>{root ? 'Your universe.' : node.id === FALLBACK_ID ? 'Not yet grouped' : node.label}</h1><p>{root ? 'Open a topic. Follow a connection. Find the videos behind it.' : fallbackView ? 'Your videos are kept here while their topics need more context.' : children.length ? 'Explore the connections within this part of your map.' : 'The real videos behind this part of your map.'}</p></header>
    <TimeRange value={timeRange} onChange={onTimeRangeChange} />
    <div className="dpu-toolbar"><span>AI-suggested topics from video titles</span>{!leaf && <label htmlFor={`${id}-sort`}>Sort by<select id={`${id}-sort`} value={sort} onChange={event => setSort(event.target.value)}><option value="balanced">For you</option><option value="volume">Most videos</option><option value="recent">Recently active</option></select></label>}</div>
    {!journal ? <p className="dpu-empty" role="status">Loading your saved history…</p> : !node.count ? <p className="dpu-empty">No videos in this view. Try a different time range.</p> : !leaf && <OrbitalTopics node={orbitNode} root={root} page={page} onPage={setPage} onOpen={openNode} rangeLabel={rangeLabel} />}
    <div className="dpu-analysis"><div><strong>{running ? 'Organizing your map' : status.state === 'paused' || analysisError ? 'Map analysis paused' : total && pending === 0 && reviewed >= total ? 'Your map is up to date' : 'Your map, taking shape'}</strong><span>{reviewed.toLocaleString('en')} / {total.toLocaleString('en')} reviewed</span></div><progress value={Math.min(reviewed, total)} max={Math.max(total, 1)} aria-label="Saved videos reviewed for map topics" /><p>All saved history · {quantity(processed, 'video')} grouped{unresolved ? ` · ${quantity(unresolved, 'video')} not yet grouped` : ''}. {quantity(pending, 'video')} ready to analyze.</p><div className="dpu-analysis-actions"><button type="button" onClick={analyzeNewVideos} disabled={!canAnalyze || running}>{running ? 'Analyzing…' : 'Analyze new videos'}</button>{running && <button type="button" className="dpu-stop" onClick={stopAnalysis}>Stop</button>}</div>{hostedAnalysis ? <><p>{website ? 'Gemini organises imported titles using your signed-in account’s remaining AI allowance. Your saved map stays in this browser.' : running ? 'Continue in the Delta website. Results return here after Google sign-in and analysis.' : 'Google sign-in on the Delta website. Uses your US$0.50 lifetime estimated AI allowance.'}</p><details className="dpu-analysis-disclosure"><summary>What is sent for analysis?</summary><p>Only the selected video titles, IDs, creator names and existing topic labels are sent, up to 12 videos per batch. Dates, watch duration and learning notes stay on this device.</p></details></> : snapshotReady && !snapshot.accessConfigured && entries.length > 0 && <p>Private access is needed to analyze new videos. Saved topics stay available.</p>}</div>
    {analysisError && <p className="dpu-error" role="alert">{analysisError}</p>}{notice && <p className="dpu-notice" role="status">{notice}</p>}
    <ShareUniverse map={model} timeRangeLabel={rangeLabel} />
    {journal && node.count > 0 && <>
      {fallback && fallback.count > 0 && <div className="dpu-ungrouped"><button type="button" onClick={() => openNode(fallback)}><span>Not yet grouped <span aria-hidden="true">·</span> <strong>{quantity(fallback.count, 'video')}</strong></span><span aria-hidden="true">›</span></button><p>Some titles need more context. You can still find every video in History.</p></div>}
      <div className="dpu-results-heading"><h3>{leaf ? 'Your videos' : root ? 'All your topics' : 'Explore subtopics'}</h3><span role="status">{leaf ? quantity(videoRows.length, 'video') : quantity(topicRows.length, root ? 'topic' : 'subtopic')}</span></div>
      <label className="dpu-search" htmlFor={`${id}-search`}><span>{leaf ? 'Find a video' : 'Find a topic or video'}</span><input id={`${id}-search`} type="search" autoComplete="off" value={query} placeholder={leaf ? 'Search video titles' : 'Search every connection'} onChange={event => { setQuery(event.target.value); setLimit(12); }} /></label>
      {!leaf && <p className="dpu-ranking">{search ? 'Matching topics at every depth and video titles.' : sort === 'balanced' ? 'Ranked by video count and recent activity.' : sort === 'volume' ? 'Topics with more video records appear first.' : 'Recently active topics appear first.'}</p>}
      {!leaf && topicRows.length > 0 && <ol className="dpu-topic-list">{topicRows.map((item, index) => <li key={item.id}><button type="button" onClick={() => openNode(item)}><span className="dpu-list-orb" aria-hidden="true">{item.unresolved ? '·' : String(index + 1).padStart(2, '0')}</span><span className="dpu-list-label"><strong>{item.label}</strong><small>{search ? item.path.join(' › ') : `${item.children.length ? `${quantity(item.children.length, 'subtopic')} · ` : ''}${item.recentCount ? `${quantity(item.recentCount, 'video')} this week` : `Last active ${lastActive(item.lastActive)}`}`}</small></span><span className="dpu-list-count"><strong>{item.count.toLocaleString('en')}</strong><small>{item.count === 1 ? 'video' : 'videos'}</small></span><span className="dpu-chevron" aria-hidden="true">›</span></button></li>)}</ol>}
      {!leaf && videoRows.length > 0 && <p className="dpu-video-count">{quantity(videoRows.length, search ? 'matching video' : 'video')} {search ? '' : 'in this topic'}</p>}
      {videoRows.slice(0, limit).map(entry => <VideoRecord key={entry.videoId} entry={entry} onLearn={onLearn} busy={busy} />)}
      {!topicRows.length && !videoRows.length && (!root || Boolean(search)) && <p className="dpu-empty">No matches. Try another title or topic.</p>}
      {videoRows.length > limit && <button type="button" className="dlj-more" onClick={() => setLimit(value => value + 12)}>Show {Math.min(12, videoRows.length - limit)} more · {videoRows.length - limit} remaining</button>}
    </>}
    <details className="dpu-settings"><summary>Map settings and backups</summary><p>Only video titles, video IDs, creator names and existing topic labels are sent when you choose Analyze. Dates, watch duration and learning notes stay on this device.</p>{hostedAnalysis ? <p className="dpu-access-state">{website ? 'Google sign-in and metered analysis run on this website. No personal access code is needed. Imported records and map results stay in this browser for your Google account.' : 'Google sign-in happens in the Delta website. No personal access code is needed. Authentication credentials stay with the website; only analysis data returns here.'}</p> : snapshotReady && <><p className="dpu-access-state">{snapshot.accessConfigured ? 'Private access connected.' : 'Private access is not connected.'}</p><form onSubmit={saveAccess}><label htmlFor={`${id}-access`}>Personal access code<input id={`${id}-access`} type="password" value={accessCode} onChange={event => setAccessCode(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Enter your private access code" /></label><button type="submit" disabled={!mapClient || savingAccess || running || !accessCode.trim()}>{savingAccess ? 'Saving…' : 'Save access'}</button></form></>}<label className="dpu-import" htmlFor={`${id}-import`}>Import a private map backup<input id={`${id}-import`} type="file" accept=".json,application/json" onChange={importMap} disabled={!mapClient || importing || running} /></label><p>{importing ? 'Importing saved classifications…' : 'Import saved classifications only. Your original video records stay unchanged.'}</p><button type="button" onClick={exportMapReview} disabled={!journal || exporting || importing || running}>{exporting ? 'Preparing private review…' : 'Export map for local review'}</button><p>Private JSON with your saved video titles, dates and map classifications. Keep this file private. Access codes, account details and lesson workspaces are excluded.</p></details>
    <p className="dpu-footnote">All time includes records already saved in Delta. Topic groups help you revisit videos; viewing a video does not establish understanding or unlock a skill.</p>
  </section>;
}
