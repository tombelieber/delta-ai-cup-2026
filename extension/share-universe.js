export const MAX_SHARED_TOPICS = 6;
export const UNIVERSE_TITLE = 'My YouTube Universe';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, fallback = '', limit = 90) => typeof value === 'string'
  ? value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) || fallback : fallback;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const formatCount = value => new Intl.NumberFormat('en').format(count(value));
const moreToExplore = node => node?.unresolved === true || /^more to explore$/i.test(clean(node?.label));

function nodeRecords(node, seen = new Set()) {
  if (!object(node) || seen.has(node)) return [];
  seen.add(node);
  return [...(Array.isArray(node.records) ? node.records : []), ...(Array.isArray(node.directRecords) ? node.directRecords : []),
    ...(Array.isArray(node.children) ? node.children.flatMap(child => nodeRecords(child, seen)) : [])];
}

function recordsByVideo(records) {
  const videos = new Map();
  for (const record of records) {
    if (!object(record) || typeof record.videoId !== 'string' || !record.videoId.trim()) continue;
    let video = videos.get(record.videoId);
    if (!video) { video = { declared: 0, tasks: new Set() }; videos.set(record.videoId, video); }
    video.declared = Math.max(video.declared, count(record.checkedTasks));
    for (const task of Array.isArray(record.tasks) ? record.tasks : []) {
      if (!object(task) || typeof task.taskId !== 'string' || !task.taskId.trim()
        || task.passed === false || task.correct === false || task.status === 'failed') continue;
      // Normalized journal tasks carry a checked numeric total. An incomplete
      // task, a started lesson or a generic passed flag is not checked evidence.
      if (Number.isFinite(task.total) || Number.isFinite(task.actualTotal) && (task.passed === true || typeof task.lessonId === 'string')) video.tasks.add(task.taskId.trim());
    }
  }
  return videos;
}

function allNodes(root) {
  const found = new Map();
  const visited = new Set();
  function visit(node) {
    if (!object(node) || visited.has(node)) return;
    visited.add(node);
    if (node !== root && typeof node.id === 'string' && !found.has(node.id)) found.set(node.id, node);
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child);
  }
  visit(root);
  for (const node of Array.isArray(root?.nodes) ? root.nodes : []) visit(node);
  return found;
}

// These choices are local UI data, not the public card payload. Keep ranking
// from buildPersonalMap, which already applies the selected range and sort.
export function shareableTopics(root) {
  return (Array.isArray(root?.children) ? root.children : []).filter(node => object(node) && !moreToExplore(node))
    .map(node => ({ id: node.id, label: clean(node.label, 'Topic'), videosExplored: recordsByVideo(nodeRecords(node)).size }))
    .filter(topic => typeof topic.id === 'string' && topic.videosExplored > 0);
}

// This is a one-way aggregate projection. Source records, account identity,
// titles, links, viewing dates and durations must never enter the return value.
export function createShareSummary(root, { selectedIds, timeRangeLabel = 'All time', includePractice = false, title = UNIVERSE_TITLE } = {}) {
  const nodes = allNodes(root);
  const ids = selectedIds === undefined ? shareableTopics(root).slice(0, MAX_SHARED_TOPICS).map(topic => topic.id)
    : Array.isArray(selectedIds) ? [...new Set(selectedIds.filter(id => typeof id === 'string'))].slice(0, MAX_SHARED_TOPICS) : [];
  const selected = ids.map(id => nodes.get(id)).filter(node => node && !moreToExplore(node));
  const visible = selected.map(node => ({ node, records: nodeRecords(node) })).filter(item => recordsByVideo(item.records).size > 0);
  const videos = recordsByVideo(visible.flatMap(item => item.records));
  const checkedPractice = [...videos.values()].reduce((total, video) => total + Math.max(video.declared, video.tasks.size), 0);
  return { schemaVersion: 1, title: clean(title, UNIVERSE_TITLE), timeRangeLabel: clean(timeRangeLabel, 'All time', 40),
    videosExplored: videos.size, topicCount: visible.length,
    topics: visible.map(({ node, records }) => ({ label: clean(node.label, 'Topic'), videosExplored: recordsByVideo(records).size })),
    ...(includePractice === true && checkedPractice > 0 ? { checkedPractice } : {}) };
}

const COLORS = ['#d7b6ff', '#aebfff', '#b1e2ed', '#e7b4d8', '#e5d1a7', '#bcdfc5'];
const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function linesFor(ctx, value, width, maxLines = 2) {
  const words = clean(value).split(' '), lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > width) { lines.push(current); current = word; }
    else current = candidate;
  }
  if (current) lines.push(current);
  const result = lines.slice(0, maxLines);
  if (lines.length > maxLines) result[maxLines - 1] += '…';
  return result.map(line => {
    if (ctx.measureText(line).width <= width) return line;
    let fitted = line.replace(/…$/, '');
    while (fitted && ctx.measureText(`${fitted}…`).width > width) fitted = fitted.slice(0, -1);
    return `${fitted}…`;
  });
}

function text(ctx, value, x, y, { size = 24, weight = 500, color = '#f5edff', align = 'center', width, maxLines = 2, lineHeight = 1.25, blockAlign = 'center' } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  const lines = width ? linesFor(ctx, value, width, maxLines) : [String(value)];
  lines.forEach((line, index) => ctx.fillText(line, x, y + (blockAlign === 'start' ? index : index - (lines.length - 1) / 2) * size * lineHeight));
}

function circle(ctx, x, y, radius, color, center = false) {
  const halo = ctx.createRadialGradient(x, y, radius * .2, x, y, radius * 1.8);
  halo.addColorStop(0, center ? '#a777e526' : `${color}14`); halo.addColorStop(1, '#00000000');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, radius * 1.8, 0, Math.PI * 2); ctx.fill();
  const fill = ctx.createRadialGradient(x - radius * .3, y - radius * .4, 0, x, y, radius);
  fill.addColorStop(0, center ? '#72508d' : '#59436d'); fill.addColorStop(1, '#171127');
  ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `${color}88`; ctx.lineWidth = 2; ctx.stroke();
}

export function drawUniverseCard(canvas, summary, { format = 'square' } = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A canvas is required.');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image preview is unavailable.');
  const story = format === 'story', width = 1080, height = story ? 1920 : 1080;
  canvas.width = width; canvas.height = height;
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#20152f'); background.addColorStop(.5, '#151024'); background.addColorStop(1, '#0e0a19');
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  for (let index = 0; index < 135; index++) {
    const x = 25 + index * 197 % 1030, y = 30 + index * 311 % (height - 60);
    ctx.globalAlpha = index % 9 ? .18 : .5; ctx.fillStyle = '#e9d8ff';
    ctx.beginPath(); ctx.arc(x, y, index % 9 ? .8 : 1.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  text(ctx, 'D E L T A', 70, story ? 104 : 66, { align: 'left', size: 24, weight: 700, color: '#cab1e7' });
  text(ctx, clean(summary?.title, UNIVERSE_TITLE), 70, story ? 198 : 145,
    { align: 'left', size: 48, weight: 700, width: 940, maxLines: 1 });
  text(ctx, clean(summary?.timeRangeLabel, 'All time'), 72, story ? 272 : 205,
    { align: 'left', size: 25, color: '#b5a6cb' });
  const cx = 540, cy = story ? 965 : 548, rx = 350, ry = story ? 430 : 235;
  for (const scale of [.48, .78, 1.13]) {
    ctx.beginPath(); ctx.ellipse(cx, cy, rx * scale, ry * scale, -.1, 0, Math.PI * 2);
    ctx.strokeStyle = '#b99dcd25'; ctx.lineWidth = 1.2; ctx.stroke();
  }
  const topics = (Array.isArray(summary?.topics) ? summary.topics : []).slice(0, MAX_SHARED_TOPICS);
  const points = topics.map((topic, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(3, topics.length); return { topic,
    x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry, color: COLORS[index] }; });
  for (const point of points) {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo((cx + point.x) / 2 + 30, (cy + point.y) / 2 - 24, point.x, point.y);
    ctx.strokeStyle = `${point.color}40`; ctx.lineWidth = 1.5; ctx.stroke();
  }
  circle(ctx, cx, cy, story ? 126 : 104, '#dab4ff', true);
  const explored = count(summary?.videosExplored);
  text(ctx, formatCount(explored), cx, cy - 12, { size: explored > 99999 ? 43 : 53, weight: 700 });
  text(ctx, 'VIDEOS IN MY UNIVERSE', cx, cy + 44, { size: 16, weight: 600, color: '#dcc9f0', width: 175, maxLines: 2, lineHeight: 1.1 });
  for (const { topic, x, y, color } of points) {
    circle(ctx, x, y, story ? 107 : 89, color);
    text(ctx, formatCount(topic.videosExplored), x, y - 31, { size: 38, weight: 700, color });
    // Keep every label's first line below the count; longer labels extend down.
    text(ctx, clean(topic.label, 'Topic'), x, y + 2, { size: story ? 22 : 18, weight: 600, width: story ? 165 : 135, maxLines: 3, lineHeight: 1.2, blockAlign: 'start' });
  }
  const footerY = story ? 1605 : 940;
  ctx.beginPath(); ctx.moveTo(70, footerY - 32); ctx.lineTo(1010, footerY - 32); ctx.strokeStyle = '#b99dcd35'; ctx.lineWidth = 1; ctx.stroke();
  const topicCount = topics.length, checked = count(summary?.checkedPractice);
  text(ctx, `${topicCount} ${topicCount === 1 ? 'topic' : 'topics'}${checked ? `  ·  ${formatCount(checked)} checked practice ${checked === 1 ? 'task' : 'tasks'}` : ''}`,
    70, footerY + 4, { align: 'left', size: 25, weight: 600, width: 940, maxLines: 2 });
  text(ctx, 'A universe of curiosity.', 70, footerY + 60, { align: 'left', size: 26, color: '#c6b4db' });
  text(ctx, 'Made with Delta', 1010, height - 55, { align: 'right', size: 20, color: '#9383a9' });
  return canvas;
}

export function universeCardFilename(format = 'square') { return `my-youtube-universe-${format === 'story' ? 'story' : 'square'}.png`; }

export function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toBlob !== 'function') { reject(new Error('Image export is unavailable.')); return; }
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The image could not be prepared.')), 'image/png');
  });
}

export function downloadUniversePng(blob, { format = 'square' } = {}) {
  if (!(blob instanceof Blob)) throw new TypeError('A PNG image is required.');
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = universeCardFilename(format); link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function canShareUniverseFile(file, nav = globalThis.navigator) {
  try { return Boolean(file && typeof nav?.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })); }
  catch { return false; }
}

// Call directly from a user click with a prepared File. This invokes the
// browser's share picker; choosing a recipient remains the user's action.
export function shareUniverseFile(file, { title = UNIVERSE_TITLE, navigator: nav = globalThis.navigator } = {}) {
  if (!canShareUniverseFile(file, nav)) return Promise.reject(new Error('Use Download image, then share the saved PNG.'));
  return nav.share({ files: [file], title: clean(title, UNIVERSE_TITLE) });
}
