import { episodes, seconds } from './data.js';

// All analysis, dialogue and memory below are disposable UI fixtures. Episode
// metadata remains in data.js; none of this text is a transcript or quotation.
export const assistantCases = ['home', 'home-evidence', 'home-goal-edit', 'home-route-partial', 'home-route-complete', 'home-no-history', 'home-unverified-history', 'home-empty', 'watching', 'point-evidence', 'chat-answer', 'memory', 'memory-edit', 'no-history', 'recorded', 'assistant-collapsed'];
export const thumbnails = { cursor: '/episodes/cursor.jpg', yc: '/episodes/yc.jpg', anthropic: '/episodes/anthropic.jpg' };
export const formatTime = (value) => {
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
};
export const parseTime = (value) => typeof value === 'string' ? seconds(value) : null;
export function mergeRanges(ranges) {
  const sorted = ranges.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start && start >= 0).map((range) => [...range]).sort((a, b) => a[0] - b[0]);
  return sorted.reduce((result, range) => {
    const previous = result.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else result.push(range);
    return result;
  }, []);
}
export const watchedSeconds = (ranges) => mergeRanges(ranges).reduce((sum, [start, end]) => sum + end - start, 0);
export function learningStats(memory) {
  const byEpisode = new Map();
  for (const item of memory) byEpisode.set(item.episodeId, [...(byEpisode.get(item.episodeId) || []), ...item.ranges]);
  const ranges = [...byEpisode.values()].map(mergeRanges).filter((value) => value.length);
  return { episodes: ranges.length, segments: ranges.reduce((sum, value) => sum + value.length, 0), seconds: ranges.reduce((sum, value) => sum + watchedSeconds(value), 0) };
}
export const learningRoute = [
  { episodeId: 'cursor', title: 'Cursor：產品工作流程' },
  { episodeId: 'yc', title: 'YC：AI 新創護城河' },
  { episodeId: 'anthropic', title: 'Anthropic：產品機會' },
].map((step) => {
  const episode = episodes.find((item) => item.id === step.episodeId);
  const start = seconds(episode.start), end = seconds(episode.end);
  return { ...step, start, end, duration: end - start };
});
// This fixed route measures interval coverage, never understanding. Clipping
// before merging also keeps unrelated/out-of-chapter viewing out of the bar.
export function getLearningRouteProgress(memory = []) {
  const steps = learningRoute.map((step) => {
    const ranges = memory.filter((item) => item.episodeId === step.episodeId).flatMap((item) => item.ranges || [])
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
      .map(([start, end]) => [Math.max(step.start, start), Math.min(step.end, end)]);
    const coveredRanges = mergeRanges(ranges);
    const gaps = [];
    let position = step.start;
    for (const [start, end] of coveredRanges) {
      if (start > position) gaps.push([position, start]);
      position = Math.max(position, end);
    }
    if (position < step.end) gaps.push([position, step.end]);
    const watched = watchedSeconds(coveredRanges), remaining = step.duration - watched;
    return { ...step, coveredRanges, gaps, watchedSeconds: watched, remainingSeconds: remaining,
      status: remaining === 0 ? 'done' : watched > 0 ? 'partial' : 'todo', isNext: false };
  });
  const nextStep = steps.find((step) => step.gaps.length);
  if (nextStep) nextStep.isNext = true;
  const totalSeconds = steps.reduce((sum, step) => sum + step.duration, 0);
  const watched = steps.reduce((sum, step) => sum + step.watchedSeconds, 0);
  const complete = !nextStep;
  return { steps, totalSeconds, watchedSeconds: watched, remainingSeconds: totalSeconds - watched,
    completedSteps: steps.filter((step) => step.status === 'done').length, totalSteps: steps.length,
    percent: complete ? 100 : Math.min(99, Math.floor(watched / totalSeconds * 100)), complete,
    next: nextStep ? { episodeId: nextStep.episodeId, title: nextStep.title, time: nextStep.gaps[0][0] } : null };
}
export function addWatchedRange(memory, episodeId, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || !(end > start)) return memory;
  const existing = memory.find((item) => item.episodeId === episodeId);
  if (!existing) return [...memory, { episodeId, ranges: [[start, end]], kind: 'session' }];
  return memory.map((item) => item.episodeId === episodeId ? { ...item, ranges: mergeRanges([...item.ranges, [start, end]]) } : item);
}
// Only this complete, explicitly seeded fixture has authored comparison text.
// A shorter range, a playback receipt, or a manual record is not evidence that
// its viewer encountered (or understood) the fixture's theme.
export function eligibleComparisonBaseline(memory, episodeId) {
  if (!['cursor', 'anthropic'].includes(episodeId)) return undefined;
  return memory.find((item) => item.episodeId === 'yc' && item.kind === 'sample'
    && mergeRanges(item.ranges).some(([start, end]) => start <= 1170 && end >= 1884));
}
export function comparisonPoints(episodeId) {
  const episode = episodes.find((item) => item.id === episodeId) || episodes[0];
  const start = seconds(episode.start);
  const gap = Math.floor((seconds(episode.end) - start) / 3);
  const descriptions = {
    cursor: [
      ['延伸', '由功能，走入每日工作流程', '已看示例講「轉換成本」；呢度補充一個應用角度：整個工作流程可以點樣留住用戶。', '基準提出框架，今次示例補充用法；同一主張有新例子，歸類為延伸。'],
      ['新角度', '產品細節，亦可以累積優勢', '除咗模型能力，速度、穩定性同修正方式，都值得放入產品決策。', '已看範圍嘅示例未涉及操作細節，因此列為另一個角度；唔代表已核對節目原話。'],
      ['反方', '今日嘅優勢，未必一直成立', '如果模型更新令原有功能變得普遍，原先嘅護城河假設可能需要重估。', '示例將「優勢可以維持」同「模型更新可能削弱優勢」並列；真實分類仍要核對條件。'],
    ],
    yc: [
      ['延伸', '累積嘅工作，點樣形成轉換成本', '由工作流程嘅價值，延伸至資料遷移同重新建立習慣嘅成本。', '同一方向增加具體成本例子，示意為延伸。'],
      ['新角度', '對手嘅定位，亦會限制行動', '技術做到，未必代表對手願意跟進；既有業務可能影響取捨。', '示例加入競爭者嘅業務限制，而唔只係產品能力。'],
      ['反方', '高轉換成本，未必等於好體驗', '用戶留低可能因為難搬走，而唔係因為滿意；兩個假設要分開測試。', '示例挑戰「留低代表體驗好」嘅推論，實際觀點仍待來源核對。'],
    ],
    anthropic: [
      ['延伸', '領域知識，幫你揀對問題', '將競爭優勢嘅框架，落到團隊對某個行業工作細節嘅理解。', '框架相近，示例補充行業情境，因此列為延伸。'],
      ['新角度', '觀察客戶，搵出工具漏咗乜', '請用戶示範一次真實工作，可能比問佢想要乜功能更有用。', '示例補充一個發現需求嘅方法，唔只係競爭定位。'],
      ['反方', '新能力，未必適合舊介面', '模型能力變咗，沿用舊有操作步驟未必最方便，可以重新測試互動方式。', '示例挑戰沿用現成介面嘅假設；唔係已驗證嘅節目反方論點。'],
    ],
  };
  return descriptions[episode.id].map(([type, title, body, reason], index) => ({ type, title, body, reason, time: start + gap * index }));
}
export const demoAnswer = '可以先留意「由功能走入工作流程」呢個延伸示例：已看基準提出轉換成本，今集示例補充產品點樣融入日常工作。下面兩條連結只係候選章節，未經逐字稿核對。';
export function filterHomeEpisodes(query = '') {
  const search = query.trim().toLocaleLowerCase();
  return episodes.filter((episode) => [episode.title, episode.fullTitle, episode.subtitle, episode.series, episode.guest, episode.topic].join(' ').toLocaleLowerCase().includes(search));
}
export function getHomeRecommendations(memory, query = '') {
  const filtered = filterHomeEpisodes(query);
  const next = getLearningRouteProgress(memory).next;
  if (query.trim() || !next) return filtered;
  return [...filtered.filter((episode) => episode.id === next.episodeId), ...filtered.filter((episode) => episode.id !== next.episodeId)];
}
export function openEpisodeState(previous, episodeId, time) {
  const episode = episodes.find((item) => item.id === episodeId);
  if (!episode) return previous;
  const start = seconds(episode.start), end = seconds(episode.end);
  const position = Number.isFinite(time) ? Math.min(end, Math.max(start, time)) : start;
  return { ...previous, page: 'watch', episodeId, time: position, playing: false, tab: 'new', collapsed: false,
    expandedPoint: null, messages: [], chatInput: '', editMemoryId: null, recorded: false, seekMessage: '' };
}
export function homeState(previous) {
  return { ...previous, page: 'home', playing: false };
}
export function createAssistantState(caseId = 'home') {
  const state = {
    page: caseId.startsWith('home') ? 'home' : 'watch', homeQuery: '', homeExpandedId: null, homeAlternativesOpen: false,
    learningGoal: '了解 AI 產品護城河', goalKind: 'sample', goalEditing: false, goalDraft: '了解 AI 產品護城河',
    routeFixture: null,
    episodeId: 'cursor', tab: 'new', expandedPoint: null, collapsed: false,
    time: seconds(episodes[0].start), playing: false,
    memory: [{ episodeId: 'yc', ranges: [[1170, 1884]], kind: 'sample' }],
    editMemoryId: null, editEpisodeId: 'yc', rangeStart: '19:30', rangeEnd: '31:24', memoryError: '',
    chatInput: '', messages: [], recorded: false, seekMessage: '',
  };
  if (caseId === 'home-evidence') state.homeExpandedId = 'cursor';
  if (caseId === 'home-goal-edit') state.goalEditing = true;
  if (caseId === 'home-route-partial') Object.assign(state, { routeFixture: 'partial', memory: [...state.memory, { episodeId: 'cursor', ranges: [[2325, 2335], [2345, 2355]], kind: 'sample' }] });
  if (caseId === 'home-route-complete') Object.assign(state, { routeFixture: 'complete', memory: learningRoute.map((step) => ({ episodeId: step.episodeId, ranges: [[step.start, step.end]], kind: 'sample' })) });
  if (caseId === 'home-no-history') state.memory = [];
  if (caseId === 'home-unverified-history') state.memory = [{ episodeId: 'yc', ranges: [[1170, 1200]], kind: 'manual' }];
  if (caseId === 'home-empty') state.homeQuery = 'no-such-episode';
  if (caseId === 'point-evidence') state.expandedPoint = 0;
  if (caseId === 'chat-answer') Object.assign(state, { tab: 'chat', messages: [{ role: 'user', text: '同我之前睇過嘅，有乜唔同？' }, { role: 'assistant', text: demoAnswer, canned: true }] });
  if (caseId === 'memory' || caseId === 'memory-edit') state.tab = 'memory';
  if (caseId === 'memory-edit') state.editMemoryId = 'yc';
  if (caseId === 'no-history') state.memory = [];
  if (caseId === 'recorded') Object.assign(state, { memory: [...state.memory, { episodeId: 'cursor', ranges: [[2325, 2331]], kind: 'session' }], time: 2331, recorded: true });
  if (caseId === 'assistant-collapsed') state.collapsed = true;
  return state;
}
