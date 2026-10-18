import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { canOfferLearning } from './contextual-learning.js';
import { JOURNAL_TIME_RANGES, filterJournalByTime, groupJournalTopics } from './journal-view.js';
import { videoThumbnailUrl, hideFailedVideoThumbnail } from './video-thumbnail.js';
import './learning-journal.css';

const number = value => Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const quantity = (value, label, plural = `${label}s`) => `${number(value).toLocaleString('en')} ${number(value) === 1 ? label : plural}`;
const planetNumber = value => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(number(value));
const hasLearning = entry => entry.learningStarted || entry.hasLesson || number(entry.checkedTasks) > 0;
function duration(value) {
  const seconds = number(value);
  if (value > 0 && seconds === 0) return 'under 1 sec';
  if (seconds < 60) return `${seconds} sec`;
  return `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} sec` : ''}`;
}
function activityDate(entry) {
  const value = entry.lastActivityAt || entry.visitedAt;
  if (!Number.isFinite(value) || value <= 0 || value > 8.64e15) return null;
  return new Date(value);
}
function dateLabel(entry) { const value = activityDate(entry); return value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(value) : 'Date unknown'; }
function dayLabel(entry) {
  const value = activityDate(entry);
  if (!value) return 'Date unknown';
  const today = new Date(), yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (value.toDateString() === today.toDateString()) return 'Today';
  if (value.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return dateLabel(entry);
}
function sourceUrl(entry) { return /^[A-Za-z0-9_-]{11}$/.test(entry.videoId || '') ? `https://www.youtube.com/watch?v=${entry.videoId}` : ''; }
function viewing(entry) {
  if (entry.hasPlayback) return `Playback recorded · ${duration(entry.watchedSeconds)}`;
  if (entry.accountHistory) return 'YouTube watch history · duration unknown';
  return entry.imported ? 'Page visit · playback not tracked' : 'Playback not tracked';
}
export function TimeRange({ value, onChange }) {
  return <div className="dlj-time"><span>Time range</span><div role="group" aria-label="Record time range">{JOURNAL_TIME_RANGES.map(range => <button key={range.id} type="button" aria-pressed={value === range.id} disabled={typeof onChange !== 'function'} onClick={() => onChange(range.id)}>{range.label}</button>)}</div></div>;
}
function RangeNote() { return <p className="dlj-range-note">All time includes records already saved in Delta. Grouped by each video’s latest activity; playback totals are cumulative. YouTube history dates have day precision.</p>; }
function LearningBadges({ entry }) {
  return <>{entry.learningStarted ? <span className="dlj-learning-badge">Lesson started</span> : entry.hasLesson ? <span className="dlj-learning-badge">Lesson saved</span> : null}{number(entry.checkedTasks) > 0 && <span className="dlj-learning-badge dlj-checked">✓ Practice checked · {quantity(entry.checkedTasks, 'task')}</span>}</>;
}
export function VideoRecord({ entry, onLearn, busy }) {
  const source = sourceUrl(entry), thumbnail = videoThumbnailUrl(entry.videoId), tasks = Array.isArray(entry.tasks) ? entry.tasks : [];
  const supported = canOfferLearning(entry.videoId);
  return <details className="dlj-record" data-learning={number(entry.checkedTasks) ? 'checked' : hasLearning(entry) ? 'lesson' : 'none'}>
    <summary><span className="dlj-record-preview" key={entry.videoId} aria-hidden="true">{thumbnail && <img className="dlj-record-thumbnail" src={thumbnail} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" width="96" height="54" onError={hideFailedVideoThumbnail} />}<span className="dlj-record-icon" hidden={Boolean(thumbnail)}>{number(entry.checkedTasks) ? '✓' : entry.hasPlayback ? '▷' : '↗'}</span></span><span className="dlj-record-heading">{source ? <a className="dlj-record-title dlj-record-title-link" href={source} target="_blank" rel="noopener noreferrer" aria-label={`Open original video: ${entry.title || 'YouTube video'}`}>{entry.title || 'YouTube video'}</a> : <strong className="dlj-record-title">{entry.title || 'YouTube video'}</strong>}<small className="dlj-record-topic">{entry.topicLabel || 'Other topics'} · {dateLabel(entry)}</small><span className="dlj-record-meta">{viewing(entry)}</span><LearningBadges entry={entry} /></span></summary>
    <div className="dlj-record-body"><dl><div><dt>Viewing</dt><dd>{entry.hasPlayback ? `${duration(entry.watchedSeconds)} of playback recorded. This does not mean the video was completed or understood.` : entry.accountHistory ? 'This video appears in your signed-in YouTube watch history. The amount watched is unknown.' : entry.imported ? 'A Chrome page visit was saved. The amount watched is unknown.' : 'No playback evidence is saved for this video.'}</dd></div><div><dt>Learning</dt><dd>{number(entry.checkedTasks) ? `${quantity(entry.checkedTasks, 'practice task')} checked against task data.` : entry.learningStarted ? 'A lesson was explicitly started. No checked practice result is saved.' : entry.hasLesson ? 'A lesson is saved. Starting or completing it is not established by this record.' : 'No lesson or practice activity saved.'}</dd></div></dl>
      {entry.accountHistory && <details className="dlj-task-results"><summary>Dates shown in YouTube history</summary><ul>{(entry.historyDates || []).map((item, index) => <li key={`${item.date || 'unknown'}-${index}`}>{item.date ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(`${item.date}T00:00:00`)) : 'Date unknown'}</li>)}</ul><p>Dates come from YouTube’s history page. Exact watch times and repeat counts are unavailable.</p></details>}
      {tasks.length > 0 && <details className="dlj-task-results"><summary>Checked practice results</summary><ol>{tasks.map((task, index) => <li key={`${task.taskId || 'task'}-${index}`}><strong>✓ Task {index + 1}{Number.isFinite(task.total) ? ` · Total ${task.total.toLocaleString('en')}` : ''}</strong>{supported && <span className="dlj-task-scope">SUMIF · Total revenue for one region</span>}{typeof task.formula === 'string' && task.formula && <code>{task.formula}</code>}{task.checkedAt && Number.isFinite(Date.parse(task.checkedAt)) && <small>Checked {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(task.checkedAt))}</small>}</li>)}</ol><p>These results apply to the checked tasks, not mastery of the whole skill.</p></details>}
      <div className="dlj-record-actions">{source && <a href={source} target="_blank" rel="noopener noreferrer">Open original video ↗</a>}{supported && <button type="button" className="dlj-learn" disabled={Boolean(busy) || typeof onLearn !== 'function'} onClick={() => onLearn(entry.videoId)}>{entry.hasLesson ? 'Resume lesson & practice' : entry.learningStarted ? 'Continue learning' : 'Learn with Delta →'}</button>}</div>
    </div>
  </details>;
}
function Empty({ loading, filtered = false }) { return <div className="dlj-empty" role={loading ? 'status' : undefined}><strong>{loading ? 'Loading your records…' : filtered ? 'No matching videos.' : 'Your record starts here.'}</strong><p>{loading ? 'Your saved videos will appear here.' : filtered ? 'Try another title, filter or time range.' : 'Videos you watch, visits you choose to import and learning you start will be kept here.'}</p></div>; }

export function LearningHistory({ journal, timeRange = 'all', onTimeRangeChange, onLearn, busy = false }) {
  const id = useId(), [search, setSearch] = useState(''), [topic, setTopic] = useState(''), [activity, setActivity] = useState('any'), [learningOnly, setLearningOnly] = useState(false), [limit, setLimit] = useState(12);
  const scoped = useMemo(() => filterJournalByTime(journal, timeRange), [journal, timeRange]);
  const entries = scoped.entries || [], topics = groupJournalTopics(scoped);
  const query = search.trim().toLowerCase();
  const rows = entries.filter(entry => (!query || (entry.title || '').toLowerCase().includes(query)) && (!topic || entry.topicId.replace(/:(knowledge|entertainment|unknown)$/, '') === topic) && (!learningOnly || hasLearning(entry)) && (activity === 'any' || activity === 'playback' && entry.hasPlayback || activity === 'youtube' && entry.accountHistory || activity === 'visit' && entry.imported && !entry.hasPlayback));
  const visibleRows = rows.slice(0, limit);
  const days = [...new Set(visibleRows.map(dayLabel))], filtersActive = Boolean(query || topic || activity !== 'any' || learningOnly);
  useEffect(() => { setLimit(12); }, [timeRange, search, topic, activity, learningOnly]);
  const clear = () => { setSearch(''); setTopic(''); setActivity('any'); setLearningOnly(false); };
  return <section className="delta-learning-journal" aria-label="Your history"><p className="dlj-intro">Videos you came across. Learning you chose to do.</p>
    <TimeRange value={timeRange} onChange={onTimeRangeChange} />
    <div className="dlj-history-tabs" role="group" aria-label="Learning activity filter"><button type="button" aria-pressed={!learningOnly} onClick={() => setLearningOnly(false)}>All videos <span>{entries.length}</span></button><button type="button" aria-pressed={learningOnly} onClick={() => setLearningOnly(true)}>Learning activity <span>{entries.filter(hasLearning).length}</span></button></div>
    <div className="dlj-history-search" role="search" aria-label="Search your video history"><label htmlFor={`${id}-search`}>Find a video<input id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search video titles" autoComplete="off" /></label><details className="dlj-filter-disclosure"><summary>Filter by activity or topic</summary><div className="dlj-filter-selects"><label htmlFor={`${id}-activity`}>Video activity<select id={`${id}-activity`} value={activity} onChange={event => setActivity(event.target.value)}><option value="any">Any activity</option><option value="playback">Playback recorded</option><option value="youtube">YouTube watch history</option><option value="visit">Chrome page visits</option></select></label><label htmlFor={`${id}-topic`}>Topic<select id={`${id}-topic`} value={topic} onChange={event => setTopic(event.target.value)}><option value="">All topics</option>{topic && !topics.some(item => item.id === topic) && <option value={topic}>Selected topic · no videos in range</option>}{topics.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label></div></details></div>
    <div className="dlj-results"><span role="status">{quantity(rows.length, 'video')}{learningOnly ? ' with learning activity' : ''}</span>{filtersActive && <button type="button" onClick={clear}>Clear filters</button>}</div>
    {!rows.length ? <Empty loading={!journal} filtered={Boolean(journal && (filtersActive || timeRange !== 'all' || entries.length))} /> : <div className="dlj-timeline">{days.map(day => <React.Fragment key={day}><h2 className="dlj-day">{day}<small>{quantity(rows.filter(entry => dayLabel(entry) === day).length, 'video')}</small></h2>{visibleRows.filter(entry => dayLabel(entry) === day).map(entry => <VideoRecord key={entry.videoId} entry={entry} onLearn={onLearn} busy={busy} />)}</React.Fragment>)}</div>}
    {rows.length > limit && <button type="button" className="dlj-more" onClick={() => setLimit(value => value + 12)}>Show {Math.min(12, rows.length - limit)} more · {rows.length - limit} remaining</button>}
    <details className="dlj-label-help"><summary>What do these labels mean?</summary><p><strong>Playback recorded:</strong> Delta recorded playing time. This is not evidence of understanding.</p><p><strong>YouTube watch history:</strong> An entry from your account history. The amount watched is unknown.</p><p><strong>Page visit:</strong> A Chrome visit was imported. The amount watched is unknown.</p><p><strong>Lesson started / saved:</strong> A separate learning action or saved material, not a completed skill.</p><p><strong>Practice checked:</strong> A task answer was checked against its data. The result applies to that task.</p></details><RangeNote />
  </section>;
}

const PALETTE = ['#c9b2ed', '#bab5f1', '#adbfe9', '#d6b8da', '#b4cadb', '#d7c7a8'];
const topicColor = key => PALETTE[[...key].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 0) % PALETTE.length];
function positions(size) { return Array.from({ length: size }, (_, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / size; return { x: 200 + Math.cos(angle) * 129, y: 222 + Math.sin(angle) * 146 }; }); }

export function PersonalLearningMap({ journal, timeRange = 'all', onTimeRangeChange, onLearn, busy = false }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, ''), [selected, setSelected] = useState(null), [pageIndex, setPageIndex] = useState(0), [search, setSearch] = useState(''), [limit, setLimit] = useState(12);
  const heading = useRef(null), planets = useRef({}), previous = useRef(null);
  const scoped = useMemo(() => filterJournalByTime(journal, timeRange), [journal, timeRange]);
  const topics = [...groupJournalTopics(scoped)].sort((a, b) => a.id.localeCompare(b.id)), entries = scoped.entries || [];
  const pages = Math.max(1, Math.ceil(topics.length / 6)), page = Math.min(pageIndex, pages - 1), visibleTopics = topics.slice(page * 6, page * 6 + 6), points = positions(visibleTopics.length);
  const selectedEntries = selected?.id === 'all' ? entries : topics.find(topic => topic.id === selected?.id)?.entries || [];
  const rows = selectedEntries.filter(entry => !search.trim() || (entry.title || '').toLowerCase().includes(search.trim().toLowerCase()));
  useEffect(() => { setLimit(12); }, [timeRange, search, selected?.id]);
  useEffect(() => { if (selected) heading.current?.focus(); else if (previous.current) planets.current[previous.current]?.focus(); }, [selected?.id]);
  const openTopic = topic => { previous.current = topic.id; setSearch(''); setSelected({ id: topic.id, label: topic.label }); };
  const back = () => { setSearch(''); setSelected(null); };
  return <section className="delta-learning-journal dlj-orbital-map" aria-label="Your personal map"><p className="dlj-intro">{selected ? 'The videos behind this part of your map.' : 'Open a topic to find the videos behind it.'}</p><TimeRange value={timeRange} onChange={onTimeRangeChange} />
    {selected ? <div className="dlj-topic-view"><button type="button" className="dlj-back-map" onClick={back}>← Back to map</button><div className="dlj-topic-heading"><h2 tabIndex={-1} ref={heading}>{selected.label}</h2><span>{quantity(selectedEntries.length, 'video')}</span></div><label className="dlj-related-search" htmlFor={`${id}-related`}>Find a video<input id={`${id}-related`} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search related videos" autoComplete="off" /></label><p className="dlj-results" role="status">{quantity(rows.length, 'video')} · showing {Math.min(limit, rows.length)}</p>{rows.length ? rows.slice(0, limit).map(entry => <VideoRecord key={entry.videoId} entry={entry} onLearn={onLearn} busy={busy} />) : <Empty loading={!journal} filtered />}{rows.length > limit && <button type="button" className="dlj-more" onClick={() => setLimit(value => value + 12)}>Show {Math.min(12, rows.length - limit)} more · {rows.length - limit} remaining</button>}</div> : !entries.length ? <Empty loading={!journal} filtered={Boolean(journal && timeRange !== 'all')} /> : <>
      <div className="dlj-universe"><div className="dlj-universe-top"><strong>{quantity(entries.length, 'video')}</strong><span>{JOURNAL_TIME_RANGES.find(range => range.id === timeRange)?.label || 'All time'}</span></div><div className="dlj-orbit-stage"><svg viewBox="0 0 400 430" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs><radialGradient id={`${id}-nebula`}><stop stopColor="#9278cf" stopOpacity=".16" /><stop offset="1" stopColor="#100c23" stopOpacity="0" /></radialGradient></defs><ellipse cx="200" cy="222" rx="188" ry="205" fill={`url(#${id}-nebula)`} />{[[75, 83], [133, 151], [175, 196]].map(([rx, ry], index) => <ellipse key={rx} cx="200" cy="222" rx={rx} ry={ry} transform={`rotate(${index % 2 ? -16 : 13} 200 222)`} fill="none" stroke="#baa5dd" strokeWidth=".65" opacity=".15" />)}{Array.from({ length: 48 }, (_, index) => <circle key={index} cx={12 + index * 83 % 376} cy={14 + index * 137 % 401} r={index % 7 ? .55 : 1.1} fill="#bbaad9" opacity={index % 7 ? .18 : .4} />)}{visibleTopics.map((topic, index) => <path key={topic.id} d={`M200,222 Q${(200 + points[index].x) / 2 + 23},${(222 + points[index].y) / 2 - 22} ${points[index].x},${points[index].y}`} fill="none" stroke={topicColor(topic.id)} strokeWidth=".7" opacity=".21" />)}</svg>
        <button type="button" className="dlj-planet dlj-planet-self" ref={node => { planets.current.all = node; }} style={{ left: '50%', top: `${222 / 4.3}%` }} onClick={() => openTopic({ id: 'all', label: 'All your videos' })} aria-label={`You: ${quantity(entries.length, 'video')}. Show all videos.`}><strong>{planetNumber(entries.length)}</strong><span>YOU</span></button>
        {visibleTopics.map((topic, index) => <button key={topic.id} type="button" className="dlj-planet" ref={node => { planets.current[topic.id] = node; }} style={{ left: `${points[index].x / 4}%`, top: `${points[index].y / 4.3}%`, '--dlj-planet-color': topicColor(topic.id) }} aria-label={`${topic.label}: ${quantity(topic.entries.length, 'video')}. Open related videos.`} onClick={() => openTopic(topic)}><strong>{planetNumber(topic.entries.length)}</strong><span>{topic.label}</span>{number(topic.checkedTasks) > 0 && <small>✓ {quantity(topic.checkedTasks, 'checked task')}</small>}</button>)}
      </div><div className="dlj-universe-caption">Each planet brings related videos together. Open one to explore.</div></div>
      {pages > 1 && <div className="dlj-topic-pages"><button type="button" disabled={page === 0} onClick={() => setPageIndex(page - 1)}>← Previous</button><span role="status">Topics {page * 6 + 1}–{Math.min((page + 1) * 6, topics.length)} of {topics.length}</span><button type="button" disabled={page === pages - 1} onClick={() => setPageIndex(page + 1)}>Next →</button></div>}
      <div className="dlj-map-key"><span>● Topics from video titles</span><span>✓ Checked tasks stay with videos</span></div>
    </>}
    <p className="dlj-map-note">Topic groups help you revisit videos. Entertainment stays neutral; a visit or playback does not earn a skill mark.</p><RangeNote />
  </section>;
}
