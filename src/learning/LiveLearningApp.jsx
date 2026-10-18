import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TriangleUpIcon, MixerHorizontalIcon, ExternalLinkIcon, FileTextIcon, Pencil2Icon, PlayIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, CheckIcon, Cross2Icon, ReloadIcon, ReaderIcon } from '@radix-ui/react-icons';
import './live-learning.css';
import { SkillOverview } from './SkillOverview.jsx';
import { emptySkills, setFamiliarity, markStarted, createPracticeEvidence, addPracticeEvidence, videoValue } from './skill-records.mjs';
import { createWebSkillStorage } from './skill-storage.js';
import { useSkillRecord } from './use-skill-record.js';
import StudyWorkspace from './StudyWorkspace.jsx';
import HostedActionWorkspace from './HostedActionWorkspace.jsx';
import WebMapWorkspace from './WebMapWorkspace.jsx';
import { studySourceFromSearch } from './study-client.mjs';

const KEY = 'delta-learning-live-v1';
// Must match the server's reviewed-source contract; old model-timed lessons cannot be restored as current.
const SOURCE_REGISTRY_VERSION = 'sumif-caption-anchors-2026-10-17-v1';
const SOURCE_VERIFICATION_STATUS = 'reviewed_source_anchors_ai_lesson_unverified';
const EMPTY_PROFILE = { interests: [], level: 'beginner', language: 'en' };
const websiteSkills = createWebSkillStorage();
const localStore = {
  async get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
  async set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
};

async function request(path, body, binary = false) {
  const response = await fetch(`/api/learning/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    let message = `The service returned ${response.status}. Please try again.`;
    try { const error = await response.json(); message = error.error?.message || error.message || (typeof error.error === 'string' ? error.error : message); } catch {}
    throw new Error(message);
  }
  return binary ? response.blob() : response.json();
}
const defaultClient = {
  generationPaused: false,
  freeTier: true,
  generate: (body) => request('generate', body),
  validate: (body) => request('validate', body),
  reteach: (body) => request('reteach', body),
  pptx: (body) => request('pptx', body, true),
};
const time = (seconds = 0) => { const value = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; };
function sourceFrom(value = {}) {
  value = value || {};
  const start = Math.min(86399, Math.max(0, Number(value.start ?? value.currentTime) || 0));
  return { videoUrl: value.videoUrl || value.url || '', title: value.title || '', start, end: Math.min(86400, Math.max(start + 1, Number(value.end) || Math.min(start + 300, Number(value.duration) || start + 300))) };
}
function timestampUrl(url, seconds) {
  try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(parsed.hostname)) return ''; if (parsed.hostname === 'youtu.be') return `https://www.youtube.com/watch?v=${encodeURIComponent(parsed.pathname.slice(1))}&t=${Math.floor(seconds || 0)}s`; parsed.searchParams.set('t', `${Math.floor(seconds || 0)}s`); return parsed.href; } catch { return ''; }
}
const errorText = (error) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const tasksFor = (lesson) => Array.isArray(lesson?.practiceTasks) && lesson.practiceTasks.length ? lesson.practiceTasks : lesson?.task ? [lesson.task] : [];

export function LearningWorkspace({ sourceVideo, client = defaultClient, storage = localStore, compact = false, embedded = false, entryView = null, onExitLesson = null }) {
  const initialSource = useMemo(() => sourceFrom(sourceVideo), [sourceVideo?.videoUrl, sourceVideo?.url, sourceVideo?.videoId]);
  const [source, setSource] = useState(initialSource);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [lesson, setLesson] = useState(null);
  const [lessonToken, setLessonToken] = useState('');
  const [formula, setFormula] = useState('');
  const [slideIndex, setSlideIndex] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [reteaching, setReteaching] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [syncRevision, setSyncRevision] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(true);
  const [interestDraft, setInterestDraft] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [historyMessage, setHistoryMessage] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [practiceTaskId, setPracticeTaskId] = useState('');
  const [teachingOpen, setTeachingOpen] = useState(false);
  const [englishLessonNeeded, setEnglishLessonNeeded] = useState(false);
  const practiceRef = useRef(null);
  const formulaRef = useRef(null);
  const workspaceRef = useRef(null);
  const operation = useRef(0);
  const storageRef = useRef(storage);
  const clientRef = useRef(client);
  const persistChain = useRef(Promise.resolve());
  const activeHydration = useRef(null);
  const persistenceEpoch = useRef(0);
  const skipHydrationWrite = useRef(false);
  const preserveOtherLanguage = useRef(false);
  storageRef.current = storage;
  clientRef.current = client;

  useEffect(() => {
    if (typeof storage.subscribe !== 'function') return;
    return storage.subscribe(() => {
      operation.current += 1; persistenceEpoch.current += 1; activeHydration.current = null;
      setNotice('Updated from another Delta view.');
      setSyncRevision((revision) => revision + 1);
    });
  }, [storage]);

  useEffect(() => {
    let active = true;
    persistenceEpoch.current += 1;
    operation.current += 1;
    activeHydration.current = null;
    setHydrated(false); setBusy(''); setError(''); setSource(initialSource);
    const read = storageRef.current.get || storageRef.current.read;
    Promise.resolve(read.call(storageRef.current, KEY)).then((saved) => {
      if (!active) return;
      const value = saved && typeof saved === 'object' ? saved : {};
      const restoredProfile = { ...EMPTY_PROFILE, ...value.profile, interests: Array.isArray(value.profile?.interests) ? value.profile.interests.filter((item) => typeof item === 'string' && item.trim() && item.length <= 80).slice(0, 5) : [] };
      if (embedded) restoredProfile.language = 'en';
      setProfile(restoredProfile); setInterestDraft(restoredProfile.interests.join(', '));
      const legacyLesson = Boolean(value.lesson) && (value.lesson.sourceVerification?.status !== SOURCE_VERIFICATION_STATUS
        || value.lesson.sourceVerification?.registryVersion !== SOURCE_REGISTRY_VERSION);
      const otherLanguage = embedded && Boolean(value.lesson) && value.lesson.profile?.language !== 'en';
      preserveOtherLanguage.current = otherLanguage;
      setEnglishLessonNeeded(otherLanguage);
      const restoredLesson = legacyLesson || otherLanguage ? null : value.lesson || null;
      const restoredTasks = tasksFor(restoredLesson);
      const restoredTask = restoredTasks.find((item) => item.id === value.practiceTaskId) || restoredTasks[0];
      const restoredFormula = typeof value.formula === 'string' ? value.formula : '';
      const restoredFeedback = value.feedback;
      const feedbackMatches = restoredLesson && typeof value.lessonToken === 'string' && value.lessonToken.trim() && restoredFeedback
        && restoredFeedback.method === 'deterministic-formula-validation' && typeof restoredFeedback.passed === 'boolean'
        && (!restoredFeedback.passed || restoredFeedback.code === 'correct') && restoredFeedback.answer === restoredFormula
        && restoredFeedback.lessonId === restoredLesson.id && restoredFeedback.taskId === restoredTask?.id
        && typeof restoredFeedback.lessonId === 'string' && typeof restoredFeedback.taskId === 'string';
      setLesson(restoredLesson); setLessonToken(legacyLesson || otherLanguage ? '' : value.lessonToken || ''); setFormula(restoredFormula);
      setPracticeTaskId(restoredTask?.id || '');
      setTeachingOpen(entryView === 'lesson' || value.teachingOpen === true); setPracticeOpen(value.practiceOpen === true);
      setSlideIndex(legacyLesson ? 0 : Number(value.slideIndex) || 0); setFeedback(feedbackMatches ? restoredFeedback : null); setReteaching(null); setSourceOpen(!restoredLesson);
      if (legacyLesson) setNotice('Source anchors have been updated. Generate a fresh lesson to use the reviewed source moments. Your video, preferences and answer draft are kept.');
      if (value.source && (!compact || !initialSource.videoUrl || value.source.videoUrl === initialSource.videoUrl)) setSource(value.source);
      // Persist this one-way migration once; ordinary external hydration must not echo a write.
      skipHydrationWrite.current = !legacyLesson; activeHydration.current = initialSource; setHydrated(true);
    }).catch(() => { if (active) { setNotice('Local storage is unavailable. This session can still be used.'); activeHydration.current = initialSource; setHydrated(true); } });
    return () => { active = false; operation.current += 1; };
  }, [initialSource, syncRevision]);

  useEffect(() => {
    if (!hydrated || activeHydration.current !== initialSource || preserveOtherLanguage.current) return;
    if (skipHydrationWrite.current) { skipHydrationWrite.current = false; return; }
    const snapshot = { schemaVersion: 1, source, profile, lesson, lessonToken, formula, slideIndex, feedback, practiceTaskId, teachingOpen, practiceOpen };
    const target = storageRef.current;
    const write = target.set || target.write;
    const saveEpoch = persistenceEpoch.current;
    persistChain.current = persistChain.current.catch(() => {}).then(() => {
      if (saveEpoch !== persistenceEpoch.current || !activeHydration.current) return;
      return write.call(target, KEY, snapshot);
    }).catch(() => setNotice('Could not save on this device. Keep this page open to retain your work.'));
  }, [hydrated, source, profile, lesson, lessonToken, formula, slideIndex, feedback, practiceTaskId, teachingOpen, practiceOpen]);

  const slides = Array.isArray(lesson?.slides) ? lesson.slides : [];
  const currentSlide = slides[Math.min(slideIndex, Math.max(slides.length - 1, 0))];
  const practiceTasks = tasksFor(lesson);
  const hasFreshPractice = Array.isArray(lesson?.practiceTasks) && lesson.practiceTasks.length > 0;
  const taskIndex = Math.max(0, practiceTasks.findIndex((item) => item.id === practiceTaskId));
  const task = practiceTasks[taskIndex];
  const nextTask = practiceTasks[taskIndex + 1];
  const evidenceOrigin = client.evidenceOrigin || globalThis.location?.origin || '';
  const skills = useSkillRecord({ storage: storage?.skills || websiteSkills, origin: evidenceOrigin, lesson, task, formula, feedback, workspaceHydrated: hydrated,
    onExternal: () => { operation.current += 1; setBusy(''); } });
  const value = videoValue(skills.record, source, evidenceOrigin);
  const profileChanged = lesson && JSON.stringify(lesson.profile) !== JSON.stringify(profile);
  const sourceChanged = lesson && (lesson.source?.videoUrl !== source.videoUrl || Number(lesson.source?.start) !== Number(source.start) || Number(lesson.source?.end) !== Number(source.end));
  const generationPaused = client.generationPaused === true;
  const canGenerate = source.videoUrl.trim().length > 0 && !busy && hydrated && !generationPaused;

  async function generate(event) {
    event?.preventDefault();
    if (generationPaused) { setError('Model generation is paused to prevent model charges. Your saved work is kept.'); return; }
    const start = Number(source.start); const end = Number(source.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 300 || end > 86400) { setError('Choose a clip of up to five minutes, ending within 24 hours.'); return; }
    if (profile.interests.length > 5 || profile.interests.some((item) => !item.trim() || item.length > 80)) { setError('Choose up to five interests, with no more than 80 characters each.'); return; }
    const serial = ++operation.current;
    setBusy('generate'); setError(''); setNotice('');
    void skills.mutate(record => markStarted(record, source));
    try {
      const result = await clientRef.current.generate({ source: { ...source, start: Number(source.start) || 0, end: Number(source.end) || 300 }, profile });
      if (operation.current !== serial) return;
      if (!result?.lesson || !Array.isArray(result.lesson.slides) || !result.lesson.slides.length || !result.lessonToken) throw new Error('The service returned an incomplete lesson. Your previous work is kept.');
      if (embedded && result.lesson.profile?.language !== 'en') throw new Error('The service did not return an English lesson. Your saved work is kept.');
      preserveOtherLanguage.current = false; setEnglishLessonNeeded(false);
      setLesson(result.lesson); setSource({ videoUrl: result.lesson.source.videoUrl, title: result.lesson.source.title || '', start: result.lesson.source.start, end: result.lesson.source.end }); setLessonToken(result.lessonToken); setSlideIndex(0); setFeedback(null); setReteaching(null); setSourceOpen(false);
      setPracticeTaskId(tasksFor(result.lesson)[0]?.id || '');
      setNotice('Your lesson is ready. Read the PPT or start practice with fresh data.');
    } catch (failure) { if (operation.current === serial) setError(errorText(failure)); }
    finally { if (operation.current === serial) setBusy(''); }
  }
  async function validate(event) {
    event.preventDefault();
    if (!formula.trim() || !lessonToken || busy || !hydrated) return;
    const serial = ++operation.current;
    const submittedAnswer = formula; const submittedLessonId = lesson.id; const submittedTaskId = task.id;
    setBusy('validate'); setError(''); setFeedback(null); setReteaching(null);
    try {
      const result = await clientRef.current.validate({ lessonToken, formula: submittedAnswer, taskId: submittedTaskId });
      if (operation.current !== serial) return;
      if (result.lessonId !== submittedLessonId || result.taskId !== submittedTaskId || result.method !== 'deterministic-formula-validation'
        || typeof result.passed !== 'boolean' || result.answer != null && result.answer !== submittedAnswer) throw new Error('The feedback did not match this lesson. Please check your answer again.');
      const bound = { ...result, answer: submittedAnswer, lessonId: submittedLessonId, taskId: submittedTaskId };
      setFeedback(bound);
      const checked = createPracticeEvidence({ lesson, task, formula: submittedAnswer, feedback: bound, origin: evidenceOrigin, checkedAt: new Date().toISOString() });
      if (checked) void skills.mutate(record => addPracticeEvidence(record, checked));
    }
    catch (failure) { if (operation.current === serial) setError(errorText(failure)); }
    finally { if (operation.current === serial) setBusy(''); }
  }
  async function reteach() {
    const serial = ++operation.current;
    setBusy('reteach'); setError('');
    try { const result = await clientRef.current.reteach({ lessonToken, formula, taskId: task.id }); if (operation.current === serial) setReteaching(result); }
    catch (failure) { if (operation.current === serial) setError(errorText(failure)); }
    finally { if (operation.current === serial) setBusy(''); }
  }
  async function download() {
    const serial = ++operation.current;
    setBusy('pptx'); setError('');
    try {
      const result = await clientRef.current.pptx({ lessonToken });
      if (operation.current !== serial) return;
      const blob = result instanceof Blob ? result : result?.blob;
      const url = blob ? URL.createObjectURL(blob) : result?.downloadUrl;
      if (!url) throw new Error('The download was not returned. Please try again.');
      const link = document.createElement('a'); link.href = url; link.download = 'Delta-lesson.pptx'; document.body.appendChild(link); link.click(); link.remove();
      if (blob) setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice('PPTX download started.');
    } catch (failure) { if (operation.current === serial) setError(errorText(failure)); }
    finally { if (operation.current === serial) setBusy(''); }
  }
  async function suggestInterests() {
    setSuggesting(true); setHistoryMessage(''); setSuggestions([]);
    try {
      const result = await clientRef.current.interests();
      const list = Array.isArray(result) ? result : result?.suggestions || [];
      setSuggestions(list.map((item) => typeof item === 'string' ? { label: item } : item).filter((item) => typeof item.label === 'string' && item.label.trim() && item.label.length <= 80).slice(0, 5));
      setHistoryMessage(result?.message || (list.length ? 'Suggestions use videos observed by Delta on this device. Confirm what fits you.' : 'No observed videos yet. You can add an interest yourself.'));
    } catch (failure) { setHistoryMessage(errorText(failure)); }
    finally { setSuggesting(false); }
  }
  function applyPreferences(event) {
    event.preventDefault();
    const interests = [...new Set(interestDraft.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))];
    if (interests.length > 5 || interests.some((item) => item.length > 80)) { setError('Choose up to five interests, with no more than 80 characters each.'); return; }
    setError(''); setProfile((old) => ({ ...old, interests })); setSettingsOpen(false);
    setNotice(lesson ? 'Preferences saved. Update the lesson to apply them; your current PPT and answer are kept.' : 'Preferences saved. Create your lesson when ready.');
  }
  function openPractice() {
    setPracticeOpen(true);
    requestAnimationFrame(() => {
      practiceRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
      formulaRef.current?.focus({ preventScroll: true });
    });
  }
  function startNextPractice() {
    if (!nextTask || !feedback?.passed || busy || !hydrated) return;
    operation.current += 1;
    setPracticeTaskId(nextTask.id); setFormula(''); setFeedback(null); setReteaching(null); setError('');
    setNotice('A new region and fresh values. Apply the same SUMIF skill.');
    openPractice();
  }
  function openTeaching(chooseSource = false) {
    setTeachingOpen(true);
    if (chooseSource) setSourceOpen(true);
    else void skills.mutate(record => markStarted(record, source));
    requestAnimationFrame(() => { workspaceRef.current?.querySelector('#live-back-to-skills')?.focus(); });
  }
  function backToSkills() {
    if (onExitLesson) { onExitLesson(); return; }
    setTeachingOpen(false);
    requestAnimationFrame(() => { workspaceRef.current?.querySelector('#skill-manage')?.focus(); });
  }
  function clearSkills() {
    operation.current += 1; setBusy('');
    void skills.mutate(() => emptySkills());
  }
  const SourceHeading = embedded ? 'h2' : 'h1';
  const evidence = lesson?.source?.evidence || [];
  const watchedRanges = Array.isArray(sourceVideo?.watchedRanges) ? sourceVideo.watchedRanges : [];
  const sourceLink = timestampUrl(lesson?.source?.videoUrl || source.videoUrl, currentSlide?.sourceTime ?? lesson?.source?.start ?? source.start);

  return <section ref={workspaceRef} className={`delta-learning-live ${compact ? 'dll-compact' : ''} ${embedded ? 'dll-embedded' : ''}`} data-learning-state={busy === 'generate' ? 'generating' : lesson ? 'ready' : 'empty'} data-hydrated={String(hydrated)} data-skills-hydrated={String(skills.available)} data-learning-view={teachingOpen ? 'teaching' : 'overview'} aria-label="Delta learning assistant">
    <header className="dll-header"><span className="dll-brand-icon"><TriangleUpIcon /></span><div><strong>Delta</strong><span>Your next skill, from this video</span></div><button id="live-settings" className="dll-icon-button" aria-label="Learning preferences" aria-expanded={settingsOpen} onClick={() => { setInterestDraft(profile.interests.join(', ')); setSettingsOpen((old) => !old); }}><MixerHorizontalIcon /></button></header>
    {settingsOpen && <section id="live-preferences" className="dll-settings" aria-label="Learning preferences"><div className="dll-line"><h2>Make it yours</h2><button className="dll-icon-button" aria-label="Close preferences" onClick={() => setSettingsOpen(false)}><Cross2Icon /></button></div><p>Use familiar examples. The skill and answer standard stay the same.</p><form onSubmit={applyPreferences}><label htmlFor="live-interests">Interests <small>Optional · up to five, separate with commas</small></label><input id="live-interests" value={interestDraft} maxLength={240} placeholder="AI products, gaming, cooking…" onChange={(event) => setInterestDraft(event.target.value)} />{typeof client.interests === 'function' ? <><button id="live-suggest-interests" type="button" className="dll-text-button" disabled={suggesting} onClick={suggestInterests}>{suggesting ? 'Checking observed videos…' : 'Suggest from local video records'}</button><p className="dll-fine">Local title hints from observed playback and any visits you chose to import. Imported visits do not prove playback or skill. This does not read your full YouTube account history; suggestions are never applied automatically.</p></> : <p className="dll-fine">In the Chrome extension, Delta can suggest interests from videos it has recorded. This website has no access to your YouTube history.</p>}{historyMessage && <p id="live-history-message" className="dll-fine" role="status">{historyMessage}</p>}{suggestions.length > 0 && <div id="live-interest-suggestions" className="dll-suggestions">{suggestions.map((item) => <button type="button" key={item.label} onClick={() => setInterestDraft((old) => [...new Set([...old.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean), item.label])].slice(0, 5).join(', '))}>{item.label}<span>Add</span></button>)}</div>}<div className="dll-settings-grid"><label>Level<select id="live-level" value={profile.level} onChange={(event) => setProfile((old) => ({ ...old, level: event.target.value }))}><option value="beginner">Beginner</option><option value="some-experience">Some experience</option></select></label><label>Language<select id="live-language" value={profile.language} onChange={(event) => setProfile((old) => ({ ...old, language: event.target.value }))}><option value="en">English</option>{!embedded && <option value="zh-HK">Cantonese / Traditional Chinese</option>}</select></label></div><button id="live-save-preferences" className="dll-primary" type="submit">Save preferences</button></form></section>}
    {skills.notice && <section id="skill-storage-error" className="dll-error" role="alert"><p>{skills.notice}</p><button id="skill-retry-storage" className="dll-text-button" onClick={skills.reload}>Retry local skill storage</button></section>}
    {!teachingOpen && <SkillOverview record={{ ...skills.record, evidence: skills.record.evidence.filter(item => item.origin === evidenceOrigin) }} value={value} source={source} hydrated={hydrated && skills.available} busy={Boolean(busy) || skills.pending}
      storageLabel={compact ? 'this Chrome profile' : 'this website in this browser'} onLearn={() => openTeaching()} onChooseSource={() => openTeaching(true)}
      onFamiliarity={(id, familiar) => { void skills.mutate(record => setFamiliarity(record, id, familiar)); }} onClear={clearSkills} />}
    <div id="live-teaching" hidden={!teachingOpen}>
    <button id="live-back-to-skills" className="dll-text-button dll-back-to-skills" type="button" onClick={backToSkills}><ChevronLeftIcon />{embedded ? 'Your map' : 'Your skill overview'}</button>
    {englishLessonNeeded && <p className="dll-notice" role="status">Your older lesson uses another language. Its saved data and answer draft are kept. Create an English lesson to continue here.</p>}
    {generationPaused && <section id="live-generation-paused" className="dll-notice" role="status"><strong>Model generation is paused</strong><p>New AI lessons are disabled to prevent model charges. Saved lessons, formula checks, rule-based help and PowerPoint export remain available.</p></section>}
    {!generationPaused && client.freeTier === true && <p id="live-generation-limited" className="dll-fine">Free lesson creation has a shared daily allowance. If it is used up, your saved lesson and practice remain available.</p>}
    <details id="live-source-editor" className="dll-source-editor" open={sourceOpen} onToggle={(event) => setSourceOpen(event.currentTarget.open)}><summary><span>Video & preferences</span><span>{time(source.start)}–{time(source.end)}</span><ChevronDownIcon /></summary><form className="dll-source" onSubmit={generate}><div className="dll-eyebrow">VIDEO TO A LESSON</div><SourceHeading>{lesson ? 'Keep learning, your way.' : 'Turn this video into something you can do.'}</SourceHeading><p className="dll-intro">A short PPT lesson. A practical task. Feedback that helps you get it right.</p><p id="live-pilot-scope" className="dll-fine"><strong>SUMIF pilot · Teacher’s Tech 00:35–03:06</strong><br />Only this checked source excerpt is available. Other videos are not enabled yet. <a href="https://www.youtube.com/watch?v=dI8w0utjUc0&t=35s" target="_blank" rel="noreferrer">Open supported source</a></p><label htmlFor="live-source-url">YouTube video</label><input id="live-source-url" type="url" required readOnly={Boolean(sourceVideo?.videoId)} placeholder="Use the supported Teacher’s Tech link" value={source.videoUrl} onChange={(event) => setSource((old) => ({ ...old, videoUrl: event.target.value, title: '' }))} />{source.title && <p className="dll-source-title">{source.title}</p>}<details className="dll-range"><summary>Clip range <span>{time(source.start)}–{time(source.end)}</span><ChevronDownIcon /></summary><div><label>Start (seconds)<input id="live-source-start" type="number" min="0" max="86400" value={source.start} onChange={(event) => setSource((old) => ({ ...old, start: event.target.value }))} /></label><label>End (seconds)<input id="live-source-end" type="number" min={Number(source.start) + 1} max={Math.min(86400, Number(source.start) + 300)} value={source.end} onChange={(event) => setSource((old) => ({ ...old, end: event.target.value }))} /></label></div><p className="dll-fine">Current pilot range: 00:35–03:06 (35–186 seconds), from the supported Teacher’s Tech video only.</p></details><div className="dll-profile-hint"><span>{profile.interests.length ? profile.interests.join(' · ') : 'No interests required'}<small>{profile.level === 'beginner' ? 'Beginner' : 'Some experience'} · {profile.language === 'en' ? 'English' : 'Cantonese'}</small></span><button type="button" className="dll-text-button" onClick={() => { setInterestDraft(profile.interests.join(', ')); setSettingsOpen(true); }}>Personalize</button></div><button id="live-generate" className="dll-primary" disabled={!canGenerate} type="submit">{generationPaused ? 'Generation paused' : busy === 'generate' ? <><ReloadIcon className="dll-spin" />Creating your lesson…</> : lesson ? <><ReloadIcon />Update lesson</> : <><FileTextIcon />Create my lesson</>}</button>{lesson && (profileChanged || sourceChanged) && <p className="dll-fine">Your current lesson stays available until the update finishes.</p>}</form></details>
    <div className="dll-messages" aria-live="polite">{error && <div id="live-error" className="dll-error" role="alert"><strong>Could not complete this step</strong><p>{error}</p><span>Your existing lesson and answer are kept. Try the same action again.</span></div>}{notice && <p id="live-notice" className="dll-notice">{notice}</p>}{!hydrated && <p className="dll-fine">Restoring your learning…</p>}{busy === 'generate' && !lesson && <div id="live-generation-loading" className="dll-loading"><FileTextIcon /><strong>Building your lesson from the selected clip</strong><p>Checking the source, adapting the examples, and preparing practice.</p><span>Keep this page open. No practice progress is awarded for generating.</span></div>}</div>
    {lesson && <>
      <section id="live-summary" className="dll-brief"><div className="dll-line"><span className="dll-eyebrow">CLIP BRIEF</span><span className="dll-time">{time(lesson.source?.start)}–{time(lesson.source?.end)}</span></div><h2>{lesson.title || slides[0]?.title || 'Your lesson'}</h2><p>{lesson.summary}</p>{lesson.source?.evidenceLabel && <p className="dll-fine">{lesson.source.evidenceLabel}</p>}<a className="dll-source-link" href={timestampUrl(lesson.source?.videoUrl, lesson.source?.start)} target="_blank" rel="noreferrer">Open original clip <ExternalLinkIcon /></a></section>
      <section id="live-learning-materials" className="dll-materials"><div className="dll-section-heading"><h2>Learning material</h2><span>PPT + practice ready</span></div><section id="live-practice-entry" className="dll-practice-entry" aria-label="Practice"><div><span className="dll-eyebrow">PRACTICE {taskIndex + 1} OF {practiceTasks.length}</span><strong>Put SUMIF to work.</strong><p>{hasFreshPractice ? 'Try a fresh dataset, different from the PPT example.' : 'Apply SUMIF to this saved lesson’s practice data.'}</p></div><button id="live-start-practice" className="dll-primary" type="button" onClick={openPractice} disabled={Boolean(busy) || !hydrated} aria-controls="live-practice"><Pencil2Icon />{feedback?.passed ? 'Review your answer' : formula ? 'Continue practice' : 'Start practice'}</button></section><section id="live-ppt" className="dll-ppt" aria-label="PPT lesson"><div className="dll-material-heading"><FileTextIcon /><strong>PPT lesson</strong><span>{slides.length} slides</span><button id="live-download-pptx" className="dll-icon-button" onClick={download} disabled={Boolean(busy)} aria-label="Download PowerPoint file"><DownloadIcon /></button></div>{currentSlide && <article id="live-slide" className="dll-slide"><span className="dll-eyebrow">{String(slideIndex + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</span><h3>{currentSlide.title}</h3>{currentSlide.body && <p>{currentSlide.body}</p>}{currentSlide.bullets?.length > 0 && <ul>{currentSlide.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}</ul>}{currentSlide.code && <pre><code>{currentSlide.code}</code></pre>}<a className="dll-source-link" href={sourceLink} target="_blank" rel="noreferrer">Source {time(currentSlide.sourceTime)} <ExternalLinkIcon /></a></article>}<nav className="dll-slide-navigation" aria-label="Slide navigation"><button id="live-slide-previous" className="dll-icon-button" disabled={slideIndex <= 0} onClick={() => setSlideIndex((old) => Math.max(0, old - 1))} aria-label="Previous slide"><ChevronLeftIcon /></button><span id="live-slide-page">{slideIndex + 1} / {slides.length}</span><button id="live-slide-next" className="dll-icon-button" disabled={slideIndex >= slides.length - 1} onClick={() => setSlideIndex((old) => Math.min(slides.length - 1, old + 1))} aria-label="Next slide"><ChevronRightIcon /></button></nav></section>
      <details id="live-practice" data-practice-task-id={task?.id} ref={practiceRef} className="dll-disclosure" open={practiceOpen} onToggle={(event) => setPracticeOpen(event.currentTarget.open)}>
        <summary id="live-practice-toggle"><Pencil2Icon /><span>Practice<small>{hasFreshPractice ? 'Fresh data' : 'Saved lesson'} · {taskIndex + 1} of {practiceTasks.length}</small></span><span className={feedback?.passed ? 'dll-pass-pill' : 'dll-ready-pill'}>{feedback?.passed ? 'Verified' : 'Ready'}</span><ChevronDownIcon /></summary>
        <div className="dll-practice-body">
          <p id="live-practice-position" className="dll-eyebrow">PRACTICE {taskIndex + 1} OF {practiceTasks.length}</p>
          <h3>{task?.title || 'Apply what you learned'}</h3>
          <p id="live-task-instructions">{task?.instructions}</p>
          {task?.exampleLabel && <p className="dll-fine">{task.exampleLabel}</p>}
          {profile.interests.length > 0 && <p className="dll-fine">Examples for {lesson.profile?.interests?.join(', ') || 'this lesson'}. Your answer is checked against the task data.</p>}
          {task?.rows && <div className="dll-table-scroll"><table id="live-task-table"><thead><tr><th aria-label="Spreadsheet row"></th>{(task.columns || []).map((column, index) => <th key={index}><small>{String.fromCharCode(65 + index)}</small>{column}</th>)}</tr></thead><tbody>{task.rows.map((row, index) => <tr key={index}><th>{(task.firstDataRow || 2) + index}</th>{row.map((value, cell) => <td key={cell}>{String(value)}</td>)}</tr>)}</tbody></table></div>}
          {task?.criteriaCell && <p className="dll-fine">Cell {task.criteriaCell}: <strong>{task.criteriaValue}</strong></p>}
          <form onSubmit={validate}>
            <label htmlFor="live-formula">Your formula</label>
            <input id="live-formula" ref={formulaRef} className="dll-formula-input" disabled={Boolean(busy) || !hydrated} value={formula} maxLength={300} placeholder="=…" autoComplete="off" spellCheck={false} onChange={(event) => { setFormula(event.target.value); setFeedback(null); setReteaching(null); }} />
            <button id="live-check-answer" className="dll-primary" type="submit" disabled={!formula.trim() || Boolean(busy)}>{busy === 'validate' ? 'Checking…' : 'Check my answer'}</button>
          </form>
          {feedback && <section id="live-feedback" className={`dll-feedback ${feedback.passed ? 'dll-feedback-pass' : ''}`} role="status" data-passed={String(Boolean(feedback.passed))}>
            <strong>{feedback.passed ? <><CheckIcon />Practice verified</> : 'Keep going — one part needs attention'}</strong>
            <p>{feedback.message}</p>
            {feedback.actualTotal != null && <p>Calculated result: <strong>{Number(feedback.actualTotal).toLocaleString()}</strong></p>}
            {!feedback.passed && <button id="live-reteach" className="dll-text-button" onClick={reteach} disabled={Boolean(busy)}>{busy === 'reteach' ? 'Preparing help…' : 'Help me understand this mistake'}</button>}
          </section>}
          {feedback?.passed && <section id="live-practice-next-step" className="dll-practice-next" aria-label="Next step">
            <span className="dll-eyebrow">NEXT STEP</span>
            <h4>{nextTask ? 'Same skill. A new challenge.' : 'Take the lesson with you.'}</h4>
            <p>{nextTask ? 'Try another region and fresh values. Your PPT stays ready for reference.' : 'Save the PPT or revisit the original clip before applying SUMIF to your own sheet.'}</p>
            {nextTask ? <button id="live-next-practice" className="dll-primary" type="button" onClick={startNextPractice} disabled={Boolean(busy) || !hydrated}>Try next challenge <ChevronRightIcon /></button> : <><a id="live-review-source" className="dll-primary dll-action-link" href={timestampUrl(lesson.source?.videoUrl, lesson.source?.start)} target="_blank" rel="noreferrer">Review original clip <ExternalLinkIcon /></a><button id="live-save-lesson" className="dll-text-button" type="button" onClick={download} disabled={Boolean(busy)}>Save the PowerPoint lesson <DownloadIcon /></button></>}
          </section>}
          {reteaching && <section id="live-reteaching" className="dll-reteaching"><span className="dll-eyebrow">TARGETED HELP</span><h4>{reteaching.title}</h4><p>{reteaching.explanation}</p>{reteaching.steps?.length > 0 && <ol>{reteaching.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}<a className="dll-source-link" href={timestampUrl(lesson.source?.videoUrl, reteaching.sourceTime)} target="_blank" rel="noreferrer">Review this source moment <ExternalLinkIcon /></a><small>Guidance based on this task’s data and answer rules.</small></section>}
        </div>
      </details>
      <div id="live-video-future" className="dll-future"><PlayIcon /><span>Teaching video<small>Planned after the PPT learning flow</small></span><span className="dll-future-pill">Future</span></div>
      <details id="live-learning-evidence" className="dll-evidence"><summary><ReaderIcon /><span>Learning evidence</span><ChevronDownIcon /></summary><ul><li><span>Observed playback</span><strong>{watchedRanges.length ? `${watchedRanges.length} recorded ranges` : 'No playback evidence in this view'}</strong></li><li><span>Understanding</span><strong>Not assessed</strong></li><li data-testid="live-practice-evidence"><span>Practice</span><strong>{feedback?.passed ? 'Formula verified against task data' : 'Not yet verified'}</strong></li></ul><p className="dll-fine">Viewing slides or generating a lesson does not prove understanding. Playback, understanding and task validation are separate.</p></details>
      <details className="dll-source-evidence"><summary>Source & limitations<ChevronDownIcon /></summary><p>{lesson.source?.title}</p>{evidence.length > 0 && <ul>{evidence.map((item, index) => <li key={index}><a href={timestampUrl(lesson.source?.videoUrl, item.start)} target="_blank" rel="noreferrer">{time(item.start)}–{time(item.end)}</a><span>{item.statement}</span></li>)}</ul>}{lesson.limitations?.length > 0 && <ul>{lesson.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>}<p className="dll-fine">This pilot supports only Teacher’s Tech, 00:35–03:06. Source anchors refer to that checked excerpt, not exact AI-verified claim timestamps. AI-generated teaching material has not been fully human-verified; check uncertain claims in the original. Interest changes the examples, not the required skill. Video generation is not included in this release.</p></details>
      </section>
    </>}
    {!lesson && !busy && hydrated && <section className="dll-empty"><FileTextIcon /><h2>One clip. A clear next step.</h2><p>Use the supported Teacher’s Tech SUMIF excerpt to create a PPT lesson and a task you can check. Other videos are not enabled yet. Interests and viewing history are optional.</p></section>}
    </div>
    <footer className="dll-footer">Delta<span>Watch → learn → try → improve</span></footer>
  </section>;
}

export default function LiveLearningApp(props) {
  const query = new URLSearchParams(globalThis.location?.search || '');
  const hosted = query.get('hosted') === '1', webMap = !hosted && query.get('map') === '1', legacy = !hosted && !webMap && query.get('legacy') === '1', study = !hosted && !webMap && !legacy && query.get('study') === '1';
  let requestedSource = null, sourceError = '';
  try { requestedSource = studySourceFromSearch(query); } catch (error) { sourceError = error.message; }
  const sourceVideo = props.sourceVideo || requestedSource;
  const labHref = `/learn?study=1${requestedSource ? `&videoId=${requestedSource.videoId}` : ''}`;
  const [entry, setEntry] = useState({ status: 'loading', config: null });
  useEffect(() => {
    if (legacy || study || hosted || webMap) return;
    let mounted = true;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    fetch('/api/study/auth-config', { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw Error('Learning service unavailable.'); const config = await response.json(); if (typeof config?.enabled !== 'boolean') throw Error('Learning service configuration incomplete.'); return config; })
      .then(config => { if (mounted) setEntry({ status: config.enabled ? 'study' : 'legacy', config }); })
      .catch(() => { if (mounted) setEntry({ status: 'error', config: null }); })
      .finally(() => clearTimeout(timeout));
    return () => { mounted = false; clearTimeout(timeout); controller.abort(); };
  }, [legacy, study, hosted, webMap]);
  const intro = <header className="dll-page-intro study-app-header"><div className="study-brand-group"><a className="dll-page-brand" href="/"><span className="study-brand-mark" aria-hidden="true">Δ</span><span>Delta</span></a><a className="study-app-section" href={labHref}>Learning lab</a><a className="study-app-section" href="/learn?map=1" aria-current={webMap ? 'page' : undefined}>My map</a></div><nav className="study-header-links" aria-label="Delta resources"><a href="#install-extension">Install pilot</a><a href="/privacy.html">Privacy</a><a href="/support.html">Support</a><details className="study-header-more"><summary>More</summary><div className="study-header-menu"><a href={labHref}>Learning lab</a><a href="/learn?map=1">My map</a><a href="/learn?legacy=1">View saved SUMIF</a></div></details></nav></header>;
  const install = <details id="install-extension" className="study-install"><summary>Install the unpacked Chrome pilot</summary><div className="study-install-content"><p className="study-install-note">Developer-mode pilot · install from the extracted ZIP. This is not a Chrome Web Store release.</p><a className="study-install-download" href="/downloads/Delta-Chrome-MVP-0.7.0.zip" download>Download Chrome pilot 0.7.0 <DownloadIcon width="14" height="14" /></a><ol><li>Download and unzip Delta Chrome pilot 0.7.0.</li><li>Open chrome://extensions, enable Developer mode, choose Load unpacked and select the extracted folder.</li><li>Open a YouTube teaching video and use Delta. Google sign-in and AI actions continue on the learning website.</li></ol></div></details>;
  if (hosted) return <main className="delta-learning-page">{intro}<HostedActionWorkspace endpoint={props.endpoint || ''} authConfig={props.authConfig} />{install}</main>;
  if (webMap) return <main className="delta-learning-page">{intro}<WebMapWorkspace endpoint={props.endpoint || ''} authConfig={props.authConfig} />{install}</main>;
  if (!legacy && sourceError) return <main className="delta-learning-page">{intro}<section className="dll-empty" role="alert"><p>{sourceError}</p></section>{install}</main>;
  if (study || !legacy && entry.status === 'study') return <main className="delta-learning-page">{intro}<StudyWorkspace sourceVideo={sourceVideo} authConfig={study ? null : entry.config} />{install}</main>;
  if (!legacy && entry.status !== 'legacy') return <main className="delta-learning-page">{intro}<section className="dll-empty" role={entry.status === 'error' ? 'alert' : 'status'}><p>{entry.status === 'error' ? 'The learning service could not be opened. Try the Learning lab again, or view your saved SUMIF separately.' : 'Opening the learning service…'}</p></section>{install}</main>;
  const legacySource = props.sourceVideo || { videoUrl: 'https://www.youtube.com/watch?v=dI8w0utjUc0', title: 'How to use SUMIF and SUMIFS in Microsoft Excel', start: 35, end: 186 };
  return <main className="delta-learning-page">{intro}<LearningWorkspace {...props} sourceVideo={legacySource} />{install}</main>;
}
