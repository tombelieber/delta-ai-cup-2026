import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MAX_SHARED_TOPICS, UNIVERSE_TITLE, canShareUniverseFile, canvasToPng, createShareSummary,
  downloadUniversePng, drawUniverseCard, shareableTopics, shareUniverseFile, universeCardFilename } from './share-universe.js';
import './share-universe.css';

export default function ShareUniverse({ map, timeRangeLabel = 'All time' }) {
  const id = useId(), dialog = useRef(null), trigger = useRef(null), canvas = useRef(null);
  const [open, setOpen] = useState(false), [selected, setSelected] = useState([]), [format, setFormat] = useState('square');
  const [includePractice, setIncludePractice] = useState(false), [image, setImage] = useState(null), [status, setStatus] = useState('');
  const choices = useMemo(() => shareableTopics(map), [map]);
  const summary = useMemo(() => createShareSummary(map, { selectedIds: selected, timeRangeLabel, includePractice }), [map, selected, timeRangeLabel, includePractice]);
  const availablePractice = useMemo(() => createShareSummary(map, { selectedIds: selected, includePractice: true }).checkedPractice || 0, [map, selected]);
  const renderKey = JSON.stringify({ summary, format });
  useEffect(() => {
    const available = new Set(choices.map(topic => topic.id));
    setSelected(current => current.every(topicId => available.has(topicId)) ? current : current.filter(topicId => available.has(topicId)));
  }, [choices]);
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setImage(null);
    try {
      drawUniverseCard(canvas.current, summary, { format });
      canvasToPng(canvas.current).then(blob => {
        if (active) setImage({ key: renderKey, blob, file: new File([blob], universeCardFilename(format), { type: 'image/png' }) });
      }).catch(() => { if (active) setStatus('The image could not be prepared. Please try again.'); });
    } catch { setStatus('Image preview is unavailable. Please try again.'); }
    return () => { active = false; };
  }, [open, summary, format, renderKey]);
  useEffect(() => () => { if (dialog.current?.open) dialog.current.close(); }, []);
  function show() {
    setSelected(choices.slice(0, MAX_SHARED_TOPICS).map(topic => topic.id)); setIncludePractice(false); setStatus(''); setImage(null); setOpen(true);
    dialog.current?.showModal();
  }
  function close() { dialog.current?.close(); }
  function closed() { setOpen(false); setImage(null); trigger.current?.focus(); }
  function toggle(topicId) {
    setImage(null); setStatus('');
    setSelected(current => current.includes(topicId) ? current.filter(value => value !== topicId)
      : current.length < MAX_SHARED_TOPICS ? [...current, topicId] : current);
  }
  function download() {
    if (!imageReady) return;
    try { downloadUniversePng(image.blob, { format }); setStatus('Your PNG is ready to save.'); }
    catch { setStatus('The image could not be downloaded. Please try again.'); }
  }
  async function share() {
    if (!imageReady) return;
    try { await shareUniverseFile(image.file, { title: UNIVERSE_TITLE }); setStatus('Image shared.'); }
    catch (error) { if (error?.name !== 'AbortError') setStatus('Sharing is unavailable here. Download the image and share the saved PNG.'); }
  }
  const imageReady = Boolean(image && image.key === renderKey && summary.topicCount), supportsShare = imageReady && canShareUniverseFile(image?.file);
  return <div className="dsu-share">
    <button type="button" className="dsu-trigger" ref={trigger} onClick={show} disabled={!choices.length} aria-describedby={!choices.length ? `${id}-unavailable` : undefined}>Share my universe <span aria-hidden="true">↗</span></button>
    {!choices.length && <p className="dsu-unavailable" id={`${id}-unavailable`} role="status">Your share card will be ready once your videos have topics.</p>}
    <dialog className="dsu-dialog" ref={dialog} onClose={closed} aria-labelledby={`${id}-title`} aria-describedby={`${id}-privacy`}>
      <header className="dsu-header"><div><p className="dsu-eyebrow">A little more you</p><h2 id={`${id}-title`}>{UNIVERSE_TITLE}</h2></div><button type="button" className="dsu-close" aria-label="Close share preview" onClick={close}>×</button></header>
      <p className="dsu-description">Choose the parts of your universe you want to share.</p>
      <p className="dsu-privacy" id={`${id}-privacy`}>Only selected topic names and counts appear. Video titles and account details stay private.</p>
      <div className="dsu-layout"><div className="dsu-controls">
        <fieldset className="dsu-topics"><legend>Pick up to {MAX_SHARED_TOPICS} topics <span>{selected.length} selected</span></legend>
          <p className="dsu-hint">Three to six looks great. You choose what makes the cut.</p>
          <div className="dsu-topic-options">{choices.map(topic => <label key={topic.id} htmlFor={`${id}-${encodeURIComponent(topic.id)}`}><input id={`${id}-${encodeURIComponent(topic.id)}`} type="checkbox" checked={selected.includes(topic.id)} disabled={!selected.includes(topic.id) && selected.length >= MAX_SHARED_TOPICS} onChange={() => toggle(topic.id)} /><span>{topic.label}</span><small>{topic.videosExplored.toLocaleString('en')}</small></label>)}</div>
        </fieldset>
        <label className="dsu-format" htmlFor={`${id}-format`}>Image format<select id={`${id}-format`} value={format} onChange={event => { setImage(null); setFormat(event.target.value); setStatus(''); }}><option value="square">Square · 1080 × 1080</option><option value="story">Story · 1080 × 1920</option></select></label>
        {availablePractice > 0 && <label className="dsu-practice" htmlFor={`${id}-practice`}><input id={`${id}-practice`} type="checkbox" checked={includePractice} onChange={event => { setImage(null); setIncludePractice(event.target.checked); setStatus(''); }} />Include {availablePractice} checked practice {availablePractice === 1 ? 'task' : 'tasks'}</label>}
      </div><figure className={`dsu-preview dsu-preview-${format}`}><canvas ref={canvas} role="img" aria-label={`${summary.title}. ${summary.videosExplored.toLocaleString('en')} videos in my universe across ${summary.topicCount} selected topics.`} /><figcaption>{summary.topics.map(topic => `${topic.label}: ${topic.videosExplored.toLocaleString('en')}`).join(' · ') || 'Select a topic to build your card.'}{summary.checkedPractice ? ` · ${summary.checkedPractice} checked practice tasks` : ''}</figcaption></figure></div>
      <footer className="dsu-footer"><p className="dsu-status" role="status">{status || (!summary.topicCount ? 'Choose at least one topic.' : !imageReady ? 'Preparing your image…' : 'Ready when you are. Nothing is posted automatically.')}</p><div className="dsu-actions"><button type="button" className="dsu-download" onClick={download} disabled={!imageReady}>Download image</button>{supportsShare && <button type="button" className="dsu-native-share" onClick={share} disabled={!imageReady}>Share image</button>}</div></footer>
    </dialog>
  </div>;
}
