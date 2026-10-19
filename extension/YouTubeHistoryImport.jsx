import React, { useEffect, useId, useRef, useState } from 'react';
import './account-history.css';
import { ACCOUNT_HISTORY_IMPORT_SCOPES as RANGES, DEFAULT_ACCOUNT_HISTORY_RANGE } from './account-history-scope.js';

const ACTIVE = new Set(['opening', 'running']);
const POLL_WINDOW = 10 * 60 * 1000;
const empty = { session: null, account: null, entryCount: 0, videoCount: 0, accountCount: 0 };
const count = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const englishError = problem => typeof problem?.message === 'string' && !/[\u4e00-\u9fff]/.test(problem.message) ? problem.message.slice(0, 300) : 'The import could not complete this step. Your saved records are kept.';

export default function YouTubeHistoryImport({ client, onImported }) {
  const id = useId(), [snapshot, setSnapshot] = useState(empty), [expanded, setExpanded] = useState(false), [disclosed, setDisclosed] = useState(false), [range, setRange] = useState(DEFAULT_ACCOUNT_HISTORY_RANGE), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pollExpired, setPollExpired] = useState(false), [pollSerial, setPollSerial] = useState(0), [clearConfirm, setClearConfirm] = useState(false);
  const mounted = useRef(false), epoch = useRef(0), locked = useRef(false), latestCount = useRef(null), notify = useRef(onImported), savedSnapshot = useRef(empty), heading = useRef(null), entryButton = useRef(null);
  notify.current = onImported;
  const available = client?.available !== false && ['status', 'open', 'confirm', 'pause', 'continueImport'].every(name => typeof client?.[name] === 'function');
  const session = snapshot.session, phase = session?.phase || 'idle', account = session?.account || snapshot.account;

  function accept(value, initial = false) {
    if (!value || value.ok === false) throw new Error(value?.error || 'The import status is unavailable. Please try again.');
    const next = { ...value, session: value.session || null, account: value.account || null, entryCount: count(value.entryCount), videoCount: count(value.videoCount), accountCount: count(value.accountCount) };
    const before = latestCount.current;
    latestCount.current = next.entryCount; savedSnapshot.current = next; setSnapshot(next);
    if (!initial && before != null && next.entryCount !== before && typeof notify.current === 'function') void (async () => { try { await notify.current(next); } catch { /* Parent controls record refresh feedback. */ } })();
    return next;
  }
  useEffect(() => {
    mounted.current = true; const serial = ++epoch.current;
    locked.current = false; latestCount.current = null; savedSnapshot.current = empty;
    setSnapshot(empty); setBusy(''); setError(''); setNotice(''); setConfirmed(false); setExpanded(false); setDisclosed(false); setPollExpired(false); setClearConfirm(false);
    if (available) void (async () => {
      try {
        const value = await client.status(); if (!mounted.current || serial !== epoch.current) return;
        const next = accept(value, true);
        setDisclosed(Boolean(next.session));
        if (['opening', 'confirm', 'running'].includes(next.session?.phase)) { setExpanded(true); setDisclosed(true); }
      } catch (problem) { if (mounted.current && serial === epoch.current) setError(englishError(problem)); }
    })();
    return () => { mounted.current = false; epoch.current += 1; };
  }, [client, available]);

  useEffect(() => { setConfirmed(false); setClearConfirm(false); }, [session?.id, account?.key, phase]);
  useEffect(() => { if (expanded) heading.current?.focus(); }, [expanded, phase === 'confirm']);

  useEffect(() => {
    if (!available || !expanded || !ACTIVE.has(phase) || pollExpired) return;
    let active = true, timer;
    const serial = epoch.current, deadline = Date.now() + POLL_WINDOW;
    async function poll() {
      if (!active || !mounted.current || serial !== epoch.current) return;
      if (Date.now() >= deadline) { setPollExpired(true); setNotice('Automatic status updates have paused. The import may still be running; refresh its status to continue updates.'); return; }
      if (!locked.current) {
        try { const value = await client.status(); if (!active || !mounted.current || serial !== epoch.current) return; const next = accept(value); if (!ACTIVE.has(next.session?.phase)) return; }
        catch (problem) { if (active && mounted.current && serial === epoch.current) { setError(englishError(problem)); return; } }
      }
      if (active) timer = setTimeout(poll, 1500);
    }
    timer = setTimeout(poll, 1500);
    return () => { active = false; clearTimeout(timer); };
  }, [client, available, expanded, phase, session?.id, pollExpired, pollSerial]);

  async function action(name, callback) {
    if (!available || locked.current) return;
    const serial = ++epoch.current; locked.current = true; setBusy(name); setError(''); setNotice(''); setPollExpired(false);
    try {
      const response = await callback();
      if (!mounted.current || serial !== epoch.current) return;
      const value = response && Object.hasOwn(response, 'session') ? response : await client.status();
      if (!mounted.current || serial !== epoch.current) return;
      const next = accept(value); setDisclosed(true); setPollSerial(value => value + 1); return next;
    } catch (problem) { if (mounted.current && serial === epoch.current) setError(englishError(problem)); }
    finally { if (mounted.current && serial === epoch.current) { locked.current = false; setBusy(''); } }
  }
  const open = event => { event.preventDefault(); void action('open', () => client.open(range)); };
  const confirm = event => {
    event.preventDefault();
    if (!confirmed || !session?.id || !account?.key) return;
    void action('confirm', () => client.confirm(session.id, account.key));
  };
  async function leave() {
    const shouldPause = available && (['opening', 'confirm', 'running'].includes(phase) || ['open', 'confirm', 'continue'].includes(busy));
    const serial = ++epoch.current; locked.current = shouldPause;
    setExpanded(false); setConfirmed(false); setClearConfirm(false); setError(''); setBusy(shouldPause ? 'pause' : '');
    setNotice(shouldPause ? 'Stopping the import. You can keep using Delta; records already imported stay saved locally.' : 'You can keep using Delta. Any imported records stay saved locally.');
    requestAnimationFrame(() => entryButton.current?.focus());
    if (shouldPause) {
      try {
        const response = await client.pause();
        if (!mounted.current || serial !== epoch.current) return;
        const value = response && Object.hasOwn(response, 'session') ? response : await client.status();
        if (!mounted.current || serial !== epoch.current) return;
        accept(value); setNotice('Import stopped. Your partial records stay saved locally. You can keep using Delta.');
      } catch (problem) { if (mounted.current && serial === epoch.current) setError(`Could not confirm the import stopped. ${englishError(problem)}`); }
      finally { if (mounted.current && serial === epoch.current) { locked.current = false; setBusy(''); } }
    }
  }
  const refresh = () => action('refresh', () => client.status());
  const sessionMessage = typeof session?.message === 'string' && !/[\u4e00-\u9fff]/.test(session.message) ? session.message.slice(0, 350) : '';
  return <section className="delta-account-history" aria-labelledby={`${id}-title`}>
    <span className="dah-optional">Optional</span><h2 id={`${id}-title`} ref={heading} tabIndex={-1}>Import YouTube history</h2>
    <p className="dah-intro">Bring past videos into your history and personal map.</p>
    {!expanded ? <>
      <p className="dah-note">From the YouTube account you choose, including other devices as shown by YouTube. You can use Delta without importing.</p>
      {snapshot.entryCount > 0 && <p className="dah-saved">{snapshot.entryCount.toLocaleString('en')} history entries · {snapshot.videoCount.toLocaleString('en')} videos saved locally</p>}
      <button type="button" className="dah-button dah-primary" ref={entryButton} disabled={Boolean(busy)} onClick={() => { setExpanded(true); setError(''); }}>{['opening', 'confirm', 'running'].includes(phase) ? 'View current import' : ['paused', 'error'].includes(phase) ? 'Review paused import' : phase === 'complete' ? 'Review imported history' : 'Import YouTube history'}</button>
    </> : <>
      {!available ? <div className="dah-unavailable"><strong>Use the Delta Chrome extension</strong><p>This page cannot read signed-in YouTube history. Open Delta’s Chrome side panel to start an optional import. No sample records are shown here.</p></div> : !disclosed || phase === 'idle' ? <form onSubmit={open}>
        <p>Delta will open YouTube history in a tab. Confirm the signed-in account before any history is collected.</p>
        <ul className="dah-scope"><li>Import the history YouTube makes available, including account history from other devices.</li><li>Keep it only in this Chrome profile. No history is uploaded to a model service.</li><li>History entries do not show playback duration or earn skill marks.</li></ul>
        <p className="dah-note">Default: latest ten videos. Your account has ten lifetime free imports, shared across imports and devices. Existing records are kept.</p>
        <details className="dah-range"><summary>Import scope and limits</summary><fieldset disabled={Boolean(busy)}><legend>History to import</legend>{RANGES.map(item => <label key={item.id}><input type="radio" name={`${id}-range`} value={item.id} checked={range === item.id} disabled={item.id!=='latest10'} onChange={() => setRange(item.id)} />{item.label}</label>)}</fieldset><p className="dah-note">Additional imports require a paid pack. The US$5 Starter Pack is not on sale yet.</p></details>
        {range === 'latest10' && <p className="dah-note">Read up to 10 distinct videos in the order shown on the history page. Delta will not scroll or load older videos. Existing saved history is kept.</p>}
        {range === 'latest100' && <p className="dah-note">Read at most 100 distinct videos. Delta scrolls briefly and stops at the video, time or scrolling limit. Partial results and all earlier saved records are kept; Shorts shelves are not opened.</p>}
        <button type="submit" className="dah-button dah-primary" disabled={Boolean(busy)}>{busy === 'open' ? 'Opening YouTube…' : 'Continue to YouTube'}</button>
        <p className="dah-note">Use YouTube’s own sign-in if needed. Delta verifies your allowance on its website with Google sign-in before saving. This import does not request Chrome browsing-history access.</p>
      </form> : <>
        {phase === 'opening' && <div className="dah-phase" role="status"><strong>Check the YouTube tab</strong><p>Sign in or choose the account in YouTube if needed. Return here to confirm the account before importing.</p></div>}
        {phase === 'confirm' && <form onSubmit={confirm}>
          <p className="dah-step">Confirm the YouTube account</p><div className="dah-account"><span>Signed in on YouTube</span><strong>{account?.label || 'Account not identified yet'}</strong></div>
          {account?.key && session?.id ? <><label className="dah-confirm" htmlFor={`${id}-confirm`}><input id={`${id}-confirm`} name="accountConfirmed" type="checkbox" checked={confirmed} required onChange={event => setConfirmed(event.target.checked)} disabled={Boolean(busy)} /><span>This is the YouTube account I want to import</span></label><p className="dah-note">{session.range === 'latest10' ? 'Allow Delta to read up to 10 distinct videos currently shown, without scrolling, and keep them on this device. Existing records are kept.' : session.range === 'latest100' ? 'Allow Delta to read at most 100 distinct videos, with bounded scrolling and time. Partial results and existing records are kept.' : 'Allow Delta to import the available history for this account and keep it on this device.'} History will not be marked as watched time or completed skills.</p><button type="submit" className="dah-button dah-primary" disabled={Boolean(busy)}>{busy === 'confirm' ? 'Confirming import allowance…' : 'Allow & import history'}</button></> : <p className="dah-note">Wait for YouTube to identify the account, then check again. No history is being collected.</p>}
          <button type="button" className="dah-text" disabled={Boolean(busy)} onClick={refresh}>Check account again</button>
        </form>}
        {phase === 'running' && <div className="dah-phase" role="status"><strong>{session.range === 'latest10' ? 'Reading the latest visible videos' : session.range === 'latest100' ? 'Reading latest videos · maximum 100' : 'Importing available history'}</strong><p>Keep the YouTube history tab open. New records are saved as the import proceeds.</p></div>}
        {['running', 'paused', 'complete', 'error'].includes(phase) && <><dl className="dah-progress" aria-label="History saved locally"><div><dt>History entries</dt><dd>{snapshot.entryCount.toLocaleString('en')}</dd></div><div><dt>Videos kept</dt><dd>{snapshot.videoCount.toLocaleString('en')}</dd></div></dl><p className="dah-note">Saved on this device. These counts do not measure playback or skills.</p></>}
        {phase === 'paused' && <div className="dah-phase"><strong>Import paused</strong><p>Your partial import is kept. Continuing will ask you to confirm the YouTube account again.</p><button type="button" className="dah-button dah-primary" disabled={Boolean(busy)} onClick={() => action('continue', () => client.continueImport())}>{busy === 'continue' ? 'Opening account confirmation…' : 'Continue import'}</button></div>}
        {phase === 'complete' && <div className="dah-phase"><strong>{['latest10', 'latest100'].includes(session.range) ? 'Bounded history selection saved' : 'Available history saved'}</strong><p>{session.range === 'latest10' ? 'The bounded import stopped without scrolling. The session message below shows how many distinct videos were selected; earlier saved records are kept.' : session.range === 'latest100' ? 'The bounded import stopped. The session message below shows its outcome; at most 100 distinct videos were selected and earlier records are kept.' : 'The import has stopped. These are the entries YouTube made available during this run, not a guarantee of your full lifetime history.'}</p></div>}
        {phase === 'error' && <div className="dah-phase"><strong>Import needs attention</strong><p>Any records already imported remain saved. Check YouTube, then try continuing and confirm the account again.</p><button type="button" className="dah-button" disabled={Boolean(busy)} onClick={() => action('continue', () => client.continueImport())}>Try continuing import</button></div>}
        {sessionMessage && <p className="dah-note">{sessionMessage}</p>}
        {['opening', 'running'].includes(phase) && <button type="button" className="dah-button" disabled={Boolean(busy)} onClick={() => action('pause', () => client.pause())}>{busy === 'pause' ? 'Stopping…' : 'Stop import'}</button>}
        {(pollExpired || error || phase === 'opening') && <button type="button" className="dah-text" disabled={Boolean(busy)} onClick={refresh}>Refresh status</button>}
        {['paused', 'complete', 'error'].includes(phase) && <button type="button" className="dah-text" disabled={Boolean(busy)} onClick={() => { setDisclosed(false); setConfirmed(false); setError(''); }}>Choose another import scope</button>}
      </>}
      <button type="button" className="dah-text dah-leave" onClick={leave}>{['opening', 'confirm', 'running'].includes(phase) ? 'Stop & continue without importing more' : 'Continue without importing'}</button>
    </>}
    {snapshot.entryCount > 0 && typeof client?.clear === 'function' && <div className="dah-manage">{clearConfirm ? <div className="dah-clear-confirm"><p>Remove imported YouTube history for <strong>{account?.label || 'this account'}</strong> from Delta on this device?</p><p className="dah-note">Your original YouTube history, imported Chrome visits, playback records, lessons and checked results are kept.</p><button type="button" className="dah-button" disabled={Boolean(busy) || !account?.key} onClick={async () => { const next = await action('clear', () => client.clear(account.key)); if (next) { setClearConfirm(false); setNotice('Imported YouTube history removed from Delta on this device. Your other records are kept.'); } }}>{busy === 'clear' ? 'Removing…' : 'Remove from Delta'}</button><button type="button" className="dah-text" disabled={Boolean(busy)} onClick={() => setClearConfirm(false)}>Cancel</button></div> : <><button type="button" className="dah-text" disabled={Boolean(busy) || !account?.key} onClick={() => setClearConfirm(true)}>Remove imported YouTube history</button>{!account?.key && <p className="dah-note">Check the YouTube account before managing its imported records.</p>}</>}</div>}
    {error && <p className="dah-error" role="alert">{error}</p>}{notice && <p className="dah-notice" role="status">{notice}</p>}
  </section>;
}
