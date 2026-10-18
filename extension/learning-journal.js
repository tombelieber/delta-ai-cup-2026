import { mergeIntervals, validVideoId } from './store.js';
import { LEARNING_PILOT } from './learning-source.js';

const MAX_ROWS_PER_SOURCE = 2000;
const MAX_DATE = 8.64e15;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cleanText = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_DATE ? value : null;
const canonicalUrl = videoId => `https://www.youtube.com/watch?v=${videoId}`;

// Source topics describe the video title, never a viewer's health, personality or ability.
const TOPICS = Object.freeze([
  { id: 'spreadsheets', label: 'Spreadsheets', match: /\b(?:excel|spreadsheets?|google sheets|sumifs?|vlookup|xlookup)\b|試算表|電子表格/i },
  { id: 'travel', label: 'Travel', match: /\b(?:travel|trips?|tourism|vacation|itinerary|packing|airports?|tokyo|taipei|japan|hong kong|jr\s*pass|rail\s*pass)\b|旅行|旅遊|九州|由布院|新幹線/i },
  { id: 'fitness', label: 'Fitness', match: /\b(?:fitness|workouts?|exercises?|strength training|yoga|pilates|gym|running|marathon)\b|健身|運動教學/i },
  { id: 'cats', label: 'Cats', match: /\b(?:cats?|kittens?|feline)\b|貓/i },
  { id: 'gaming', label: 'Gaming', match: /\b(?:gameplay|gaming|games?|minecraft|roblox|pokemon|fortnite|gamers?)\b|遊戲|電玩/i },
  { id: 'music', label: 'Music', match: /\b(?:music|songs?|concerts?|guitar|piano|singing|singers?|albums?|soundtrack|orchestra|live session|fancam)\b|音樂|歌曲|演唱會/i },
  { id: 'sports', label: 'Sports', match: /\b(?:sports?|football|soccer|basketball|tennis|baseball|nba|nfl|hockey|fifa)\b|足球|籃球|體育|劍擊|游泳|亞運/i },
  { id: 'finance', label: 'Finance', match: /\b(?:finance|financial|invest|investing|investments?|budgeting|budgets?|money)\b|理財|投資|預算/i },
  { id: 'coffee', label: 'Coffee', match: /\b(?:coffee|espresso|cafe|barista)\b|café|咖啡/i },
  // Specific content topics above take precedence over an incidental AI tag.
  { id: 'technology', label: 'Technology', match: /\b(?:ai|artificial intelligence|programming|coding|python|javascript|typescript|software|chatgpt|gemini|computers?|technology|tech)\b|人工智能|人工智慧|編程/i },
]);
const ENTERTAINMENT = /\b(?:funny|funniest|memes?|pranks?|vlogs?|gameplay|reactions?|reacts|highlights|trailers?|comedy|stand[- ]?up|full movie|official (?:music )?video|cute (?:cats?|kittens?)|live streams?|livestreams?|game match|fancam|cats? dancing|(?:music|piano|guitar|singing) performance|live session)\b|搞笑|精華|惡搞|演唱會|實況|比賽|貓(?:咪)?.{0,4}(?:跳舞|可愛)/i;
const TEACHING = /\b(?:how to|how does|how do|tutorials?|lessons?|explained|explainers?|step[- ]by[- ]step|learn|guides?|tips|techniques?|workouts?|exercises?)\b|教學|教你|入門|解說/i;

export function topicForVideo({ videoId, title } = {}) {
  const text = cleanText(title, 300);
  const topic = videoId === LEARNING_PILOT.videoId ? TOPICS[0] : TOPICS.find(item => item.match.test(text)) || { id: 'other', label: 'Other topics' };
  const kind = videoId === LEARNING_PILOT.videoId ? 'knowledge' : ENTERTAINMENT.test(text) ? 'entertainment' : TEACHING.test(text) ? 'knowledge' : 'unknown';
  return { id: `${topic.id}:${kind}`, label: topic.label, kind };
}

function checkedTasks(values) {
  const byId = new Map();
  for (const value of (Array.isArray(values) ? values : []).slice(0, MAX_ROWS_PER_SOURCE)) {
    if (!object(value) || typeof value.taskId !== 'string' || !value.taskId.trim() || value.taskId.length > 100
      || /[\u0000-\u001f\u007f]/.test(value.taskId) || !Number.isFinite(value.total)) continue;
    let checkedAt = null;
    if (value.checkedAt != null) {
      if (typeof value.checkedAt !== 'string') continue;
      const parsed = Date.parse(value.checkedAt);
      if (!timestamp(parsed) || new Date(parsed).toISOString() !== value.checkedAt) continue;
      checkedAt = value.checkedAt;
    }
    const task = { taskId: value.taskId.trim(), total: value.total, checkedAt, formula: cleanText(value.formula, 1000) };
    const previous = byId.get(task.taskId);
    if (!previous || (Date.parse(task.checkedAt) || 0) >= (Date.parse(previous.checkedAt) || 0)) byId.set(task.taskId, task);
  }
  return [...byId.values()].sort((a, b) => (Date.parse(b.checkedAt) || 0) - (Date.parse(a.checkedAt) || 0) || a.taskId.localeCompare(b.taskId));
}

function historyDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number), date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : null;
}

export function buildLearningJournal({ data, visits, accountEntries, items } = {}) {
  const byVideo = new Map();
  const titleRank = new Map();
  const titleTime = new Map();
  function entryFor(videoId, title, rank, at = 0) {
    if (!validVideoId(videoId)) return null;
    let entry = byVideo.get(videoId);
    if (!entry) {
      entry = { videoId, title: 'YouTube video', url: canonicalUrl(videoId), topicId: '', topicLabel: '', kind: 'unknown',
        watchedSeconds: 0, hasPlayback: false, imported: false, visitedAt: null, learningStarted: false,
        hasLesson: false, tasks: [], checkedTasks: 0, lastActivityAt: 0 };
      byVideo.set(videoId, entry);
    }
    const safeTitle = cleanText(title, 300);
    if (safeTitle && (rank > (titleRank.get(videoId) || 0) || rank === titleRank.get(videoId) && at > (titleTime.get(videoId) || 0))) {
      entry.title = safeTitle; titleRank.set(videoId, rank); titleTime.set(videoId, at);
    }
    return entry;
  }
  const videos = object(data?.videos) ? data.videos : {};
  for (const videoId of Object.keys(videos).slice(0, MAX_ROWS_PER_SOURCE)) {
    const video = videos[videoId];
    if (!validVideoId(videoId) || !object(video) || video.videoId != null && video.videoId !== videoId
      || !Number.isFinite(video.duration) || video.duration <= 0) continue;
    const ranges = mergeIntervals((Array.isArray(video.ranges) ? video.ranges : []).slice(0, MAX_ROWS_PER_SOURCE), video.duration);
    if (!ranges.length) continue;
    const entry = entryFor(videoId, video.title, 3, timestamp(video.updatedAt) || 0);
    entry.watchedSeconds = ranges.reduce((total, [start, end]) => total + end - start, 0);
    entry.hasPlayback = entry.watchedSeconds > 0;
    entry.lastActivityAt = timestamp(video.updatedAt) || 0;
  }
  for (const visit of (Array.isArray(visits) ? visits : []).slice(0, MAX_ROWS_PER_SOURCE)) {
    if (!object(visit) || !validVideoId(visit.videoId) || visit.url !== canonicalUrl(visit.videoId)
      || !timestamp(visit.lastVisitTime) || !timestamp(visit.importedAt)) continue;
    const entry = entryFor(visit.videoId, visit.title, 2, visit.lastVisitTime);
    entry.imported = true;
    entry.visitedAt = Math.max(entry.visitedAt || 0, visit.lastVisitTime);
    entry.lastActivityAt = Math.max(entry.lastActivityAt, visit.lastVisitTime);
  }
  // Account events are kept in their own store without a lifetime row cap. A
  // displayed day is a date boundary for filtering, never a measured watch time.
  for (const value of Array.isArray(accountEntries) ? accountEntries : []) {
    if (!object(value) || !validVideoId(value.videoId) || value.url !== canonicalUrl(value.videoId)
      || !timestamp(value.importedAt) || !['day', 'unknown'].includes(value.datePrecision)) continue;
    const at = value.datePrecision === 'day' ? historyDay(value.date) : null;
    if (value.datePrecision === 'day' && at === null || value.datePrecision === 'unknown' && value.date !== null) continue;
    const entry = entryFor(value.videoId, value.title, 2, at || 0);
    entry.accountHistory = true;
    entry.historyDates ||= [];
    const date = { date: value.date, dateLabel: cleanText(value.dateLabel, 100), datePrecision: value.datePrecision };
    if (!entry.historyDates.some(item => item.date === date.date && (date.date !== null || item.dateLabel === date.dateLabel))) entry.historyDates.push(date);
    entry.historyDates.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    entry.lastActivityAt = Math.max(entry.lastActivityAt, at || 0);
  }
  for (const item of (Array.isArray(items) ? items : []).slice(0, MAX_ROWS_PER_SOURCE)) {
    if (!object(item) || !validVideoId(item.videoId)) continue;
    const entry = entryFor(item.videoId, item.title, 1, timestamp(item.enrolledAt) || 0);
    entry.learningStarted = true;
    entry.hasLesson ||= item.hasLesson === true;
    entry.tasks = checkedTasks([...entry.tasks, ...(Array.isArray(item.tasks) ? item.tasks.slice(0, MAX_ROWS_PER_SOURCE) : [])]);
    entry.checkedTasks = entry.tasks.length;
    entry.lastActivityAt = Math.max(entry.lastActivityAt, timestamp(item.enrolledAt) || 0,
      ...entry.tasks.map(task => Date.parse(task.checkedAt) || 0));
  }
  const entries = [...byVideo.values()].map(entry => {
    const topic = topicForVideo(entry);
    return { ...entry, topicId: topic.id, topicLabel: topic.label, kind: topic.kind };
  }).sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.videoId.localeCompare(b.videoId));
  const totals = rows => ({ watched: rows.filter(entry => entry.hasPlayback).length,
    imported: rows.filter(entry => entry.imported).length, learning: rows.filter(entry => entry.learningStarted).length,
    checkedTasks: rows.reduce((total, entry) => total + entry.checkedTasks, 0) });
  const grouped = new Map();
  for (const entry of entries) {
    let group = grouped.get(entry.topicId);
    if (!group) { group = { id: entry.topicId, label: entry.topicLabel, kind: entry.kind, entries: [] }; grouped.set(entry.topicId, group); }
    group.entries.push(entry);
  }
  const kindOrder = { knowledge: 0, entertainment: 1, unknown: 2 };
  const groups = [...grouped.values()].map(group => ({ ...group, ...totals(group.entries) }))
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.entries[0].lastActivityAt - a.entries[0].lastActivityAt || a.id.localeCompare(b.id));
  return { entries, groups, summary: { videos: entries.length, ...totals(entries) } };
}
