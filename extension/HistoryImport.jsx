import React, { useEffect, useId, useRef, useState } from 'react';
import './history-import.css';

const dateLabel = (value) => Number.isFinite(value) ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(value) : 'Visit date unavailable';
const emptyStatus = { granted: false, visits: [], updatedAt: null };

export default function HistoryImport({ client, onContinue = () => {} }) {
  const id = useId();
  const [step, setStep] = useState('entry');
  const [status, setStatus] = useState(emptyStatus);
  const [days, setDays] = useState(30);
  const [review, setReview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const mounted = useRef(false), version = useRef(0), lock = useRef(false), previousStep = useRef('entry');
  const heading = useRef(null), entry = useRef(null), selectionError = useRef(null);
  const available = client?.available === true;

  useEffect(() => {
    mounted.current = true;
    const current = ++version.current;
    lock.current = false;
    setBusy(''); setStep('entry'); setStatus(emptyStatus); setReview(null); setSelected(new Set()); setError(''); setNotice('');
    if (available) {
      void (async () => {
        try { const result = await client.status(); if (mounted.current && current === version.current) setStatus(result); }
        catch { if (mounted.current && current === version.current) setError('Past visits could not be loaded. You can keep learning and try again later.'); }
      })();
    }
    return () => {
      mounted.current = false; version.current += 1;
      if (available) void (async () => { try { await client.cancel(); } catch { /* No pending review can be imported by this closed view. */ } })();
    };
  }, [client, available]);

  useEffect(() => {
    if (step !== previousStep.current) (step === 'entry' ? entry : heading).current?.focus();
    previousStep.current = step;
  }, [step]);

  const isCurrent = (current) => mounted.current && current === version.current;
  const begin = (name) => {
    if (lock.current) return null;
    lock.current = true;
    const current = ++version.current;
    setBusy(name); setError(''); setNotice(''); setConfirmation('');
    return current;
  };
  const finish = (current) => { if (isCurrent(current)) { lock.current = false; setBusy(''); } };
  const cancelPending = () => {
    version.current += 1; lock.current = false;
    setBusy(''); setReview(null); setSelected(new Set()); setError(''); setConfirmation('');
    if (available) void (async () => { try { await client.cancel(); } catch { /* Leaving never blocks learning. */ } })();
  };
  const continueLearning = () => { cancelPending(); setStep('entry'); onContinue(); };
  const back = () => { cancelPending(); setStep('entry'); entry.current?.focus(); };
  const scan = async () => {
    const current = begin('scan');
    if (current === null) return;
    try {
      // Call directly in the click handler. client.preview requests native permission
      // before its first await; do not add an awaited preflight here.
      const result = await client.preview(days);
      if (!isCurrent(current)) return;
      setReview(result); setSelected(new Set()); setStatus((value) => ({ ...value, granted: true })); setStep('review');
    } catch (problem) {
      if (isCurrent(current) && problem?.code !== 'cancelled') {
        if (problem?.code === 'permission_denied') setStatus((value) => ({ ...value, granted: false }));
        setError(problem?.message || 'The history scan could not finish. Please try again.');
      }
    } finally { finish(current); }
  };
  const commit = async (event) => {
    event.preventDefault();
    if(selected.size>10){setError('Select up to ten videos. Additional imports are not on sale yet.');return;}
    if (!selected.size) { setError('Select at least one video to import, or continue without importing.'); requestAnimationFrame(() => selectionError.current?.focus()); return; }
    const current = begin('import');
    if (current === null) return;
    try {
      const result = await client.importSelected(review.token, [...selected]);
      if (!isCurrent(current)) return;
      setStatus(result); setReview(null); setSelected(new Set()); setStep('entry');
      setNotice(`${selected.size} ${selected.size === 1 ? 'video visit saved' : 'video visits saved'} on this device. Learning progress is unchanged.`);
      entry.current?.focus();
    } catch (problem) { if (isCurrent(current) && problem?.code !== 'cancelled') setError(problem?.message || 'The selected visits could not be saved. Please scan again.'); }
    finally { finish(current); }
  };
  const manage = async (action) => {
    const current = begin(action);
    if (current === null) return;
    try {
      const result = await client[action]();
      if (!isCurrent(current)) return;
      setStatus(result); setReview(null); setSelected(new Set()); setStep('entry');
      setNotice(action === 'clear' ? 'Imported visits removed. Your saved lessons and practice results are unchanged.' : 'History access disconnected. Imported visits stay on this device until you remove them. You can keep learning.');
    } catch (problem) { if (isCurrent(current)) setError(problem?.message || 'This action could not finish. Please try again.'); }
    finally { finish(current); }
  };
  const changeRange = () => { cancelPending(); setStep('access'); };

  return <section className="delta-history" aria-labelledby={`${id}-title`}>
    <span className="delta-history-optional">Optional</span>
    {step === 'entry' ? <>
      <h2 id={`${id}-title`} ref={entry} tabIndex={-1}>Import past YouTube visits</h2>
      <p>Help Delta understand your interests sooner. You can start learning without this.</p>
      <button type="button" className="delta-history-button" disabled={Boolean(busy)} onClick={() => { setError(''); setNotice(''); setStep('access'); }}>Review optional access →</button>
      {status.visits.length > 0 && <div className="delta-history-imported">
        <h3>{status.visits.length} imported {status.visits.length === 1 ? 'video' : 'videos'}</h3>
        <p className="delta-history-note">Visited pages, kept separately from lessons and checked skills.</p>
        <details><summary>Review imported visits</summary><ul className="delta-history-visits">{status.visits.map((visit) => <li key={visit.videoId}><a href={visit.url} target="_blank" rel="noopener noreferrer">{visit.title || 'YouTube video'} ↗</a><small>Last visited {dateLabel(visit.lastVisitTime)}</small></li>)}</ul></details>
      </div>}
    </> : <>
      <button type="button" className="delta-history-back" onClick={back}>← Back to saved learning</button>
      <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>{step === 'review' ? 'Choose visits to keep' : 'Past YouTube visits'}</h2>
      {step === 'access' ? <>
        <p>Find videos you have visited before. You choose what to keep.</p>
        <dl className="delta-history-scope">
          <div><dt>From this Chrome profile</dt><dd>Video titles, links and visit times still available in Chrome. This is not your Google account’s full YouTube history.</dd></div>
          <div><dt>Chrome grants browsing-history access</dt><dd>That permission covers browsing history. Delta filters on this device to use only YouTube video visits. This import does not upload your history or send it to an AI service.</dd></div>
          <div><dt>Review before importing</dt><dd>Nothing is selected for you. Visits can suggest interests; they do not show playback time or prove a skill.</dd></div>
        </dl>
        <fieldset className="delta-history-range" disabled={Boolean(busy)}><legend>Look back</legend>{[7, 30, 90].map((value) => <label key={value}><input type="radio" name={`${id}-days`} value={value} checked={days === value} onChange={() => setDays(value)} />{value} days</label>)}</fieldset>
        {available ? <button type="button" className="delta-history-button delta-history-primary" disabled={Boolean(busy)} onClick={scan}>{busy === 'scan' ? 'Waiting for Chrome and finding visits…' : 'Allow in Chrome & review visits'}</button> : <p className="delta-history-note">Open Delta in Chrome’s side panel to import past visits. Lessons and practice are available without importing.</p>}
        <p className="delta-history-note">Chrome will ask you to allow or decline access. Allowing access does not import anything until you select videos and save them. Delta only scans when you ask.</p>
        <details className="delta-history-disclosure"><summary>What about YouTube account history?</summary><p>Use “Import YouTube history” above for the history shown in your signed-in YouTube account. This Chrome option imports browser page visits only. The standard YouTube Data API does not provide direct access to watch history.</p><a href="https://developers.google.com/youtube/v3/revision_history#september-15-2016" target="_blank" rel="noopener noreferrer">YouTube API documentation ↗</a></details>
      </> : <form className="delta-history-review" onSubmit={commit}>
        <p>{review?.visits.length || 0} matching {review?.visits.length === 1 ? 'video' : 'videos'} from the last {review?.days || days} days. Nothing is selected automatically. Ten lifetime free imports per Delta account; Google sign-in opens on the Delta website before saving.</p>
        {review?.truncated && <p className="delta-history-note">Chrome returned a limited set of recent matches. This may not include every visit in the selected period.</p>}
        {review?.visits.length ? <fieldset disabled={Boolean(busy)}><legend>Select up to ten videos to import</legend><ul className="delta-history-visits delta-history-selection">{review.visits.map((visit) => <li key={visit.videoId}><label><input type="checkbox" name="videoIds" value={visit.videoId} checked={selected.has(visit.videoId)} onChange={(event) => { const checked = event.target.checked; setSelected((previous) => { const next = new Set(previous); if (checked) next.add(visit.videoId); else next.delete(visit.videoId); return next; }); setError(''); }} /><span>{visit.title || 'YouTube video'}<small>Last visited {dateLabel(visit.lastVisitTime)}</small></span></label><a href={visit.url} target="_blank" rel="noopener noreferrer" aria-label={`Open original video: ${visit.title || 'YouTube video'}`}>Original video ↗</a></li>)}</ul></fieldset> : <p className="delta-history-note">No matching visits were found. Try a different time range, or keep learning as usual.</p>}
        {review?.visits.length > 0 && <button type="submit" className="delta-history-button delta-history-primary" disabled={Boolean(busy)}>{busy === 'import' ? 'Confirming import allowance…' : `Import selected${selected.size ? ` (${selected.size})` : ''}`}</button>}
        <button type="button" className="delta-history-button" disabled={Boolean(busy)} onClick={changeRange}>Choose another time range</button>
        <p className="delta-history-note">Saved only in this Chrome profile. Imported visits do not earn completion marks.</p>
      </form>}
      <button type="button" className="delta-history-button delta-history-continue" onClick={continueLearning}>Continue without importing</button>
    </>}
    {error && <p className="delta-history-error" role="alert" tabIndex={-1} ref={selectionError}>{error}</p>}
    <p className="delta-history-status" role="status">{notice}</p>
    {available && (status.granted || status.visits.length > 0) && <div className="delta-history-manage">
      <p className="delta-history-note">{status.granted ? 'Chrome history access is currently allowed.' : 'Chrome history access is currently off.'} You control access and saved visits.</p>
      {confirmation ? <div className="delta-history-confirm"><p>{confirmation === 'clear' ? 'Remove all imported visits from Delta? Your saved lessons and practice results will stay.' : 'Disconnect Chrome history access? Imported visits stay on this device until you remove them. Lessons and practice stay available.'}</p><button type="button" className="delta-history-button" disabled={Boolean(busy)} onClick={() => manage(confirmation)}>{busy ? 'Working…' : confirmation === 'clear' ? 'Remove imported visits' : 'Disconnect history access'}</button><button type="button" className="delta-history-button" disabled={Boolean(busy)} onClick={() => setConfirmation('')}>Cancel</button></div> : <>
        {status.visits.length > 0 && <button type="button" className="delta-history-text-button" disabled={Boolean(busy)} onClick={() => setConfirmation('clear')}>Remove imported visits</button>}
        {status.granted && <button type="button" className="delta-history-text-button" disabled={Boolean(busy)} onClick={() => setConfirmation('disconnect')}>Disconnect history access</button>}
      </>}
    </div>}
  </section>;
}
