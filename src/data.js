// Episode metadata is real. Point text, explanations and comparisons are authored
// UI fixtures, not a transcript-derived analysis or quotations from the speakers.
export const episodes = [
  {
    id: 'cursor', series: "Lenny’s Podcast", guest: 'Michael Truell · Cursor',
    title: 'The rise of Cursor', subtitle: 'The $300M ARR AI tool that engineers can’t stop using',
    fullTitle: 'The rise of Cursor: The $300M ARR AI tool that engineers can’t stop using | Michael Truell',
    topic: '產品體驗，點樣變成競爭優勢？', date: '2025.05.01',
    videoId: 'En5cSXgGvZM', official: 'https://www.lennysnewsletter.com/p/the-rise-of-cursor-michael-truell',
    start: '38:45', end: '46:16', excerpt: '7 分 31 秒', color: 'peach', cover: 'CURSOR', coverSub: 'BUILDING AN AI PRODUCT',
    overview: '以 AI 開發工具為背景，探索產品體驗、工作流程同持續創新，點樣構成一個產品嘅競爭優勢。',
    points: [
      { title: '由一個功能，走入日常工作流程', body: '假設產品能連接用戶每日嘅工作，價值就唔只係單次輸出；比較時要留意，便利係來自整合，定只係多咗功能。', explanation: '示例：將「生成一段程式碼」同「協助完成整個修改流程」分開睇。後者可能減少切換工具，但仍要用實際使用情境驗證。' },
      { title: '好體驗，要靠細節持續累積', body: '假設競爭對手都用到相近模型，速度、穩定性同操作細節，就可能影響用戶會唔會持續使用。', explanation: '示例：同樣做到一項任務，較少等待、較易修正嘅流程可能更有吸引力。呢個係討論用假設，未有節目逐字稿或用戶測試支持。' },
      { title: '優勢需要隨模型能力更新', body: '假設底層模型不斷進步，今日有用嘅功能未必長期稀缺；產品需要重新確認，自己解決緊邊個問題。', explanation: '示例：模型更新後，原本要多步先完成嘅工作可能變得簡單。團隊可重新測試自己嘅流程，睇價值有冇改變。' },
    ],
  },
  {
    id: 'yc', series: 'YC · Lightcone', guest: 'Y Combinator',
    title: 'The 7 Most Powerful Moats For AI Startups', subtitle: 'AI 新創嘅競爭優勢',
    fullTitle: 'The 7 Most Powerful Moats For AI Startups', topic: 'AI 產品可以靠乜留住用戶？', date: '2025.10.03',
    videoId: 'bxBzsSsqQAM', official: 'https://www.ycombinator.com/library/Mx-the-7-most-powerful-moats-for-ai-startups',
    start: '19:30', end: '31:24', excerpt: '11 分 54 秒', color: 'orange', cover: 'LIGHTCONE', coverSub: 'THE STARTUP PERSPECTIVE',
    overview: '以 AI 新創為背景，探索轉換成本、產品定位同競爭者嘅限制，作為思考競爭優勢嘅起點。',
    points: [
      { title: '轉換成本，可能來自累積嘅工作', body: '假設用戶已將資料同工作流程放入產品，轉用另一工具嘅成本可能增加；但成本高唔等於體驗好。', explanation: '示例：搬走多年整理嘅資料需要時間。討論競爭優勢時，可以分開考慮資料遷移成本同用戶滿意度。' },
      { title: '定位取捨，會限制競爭者跟進', body: '假設一個新做法會影響既有業務，競爭者即使有技術能力，都未必願意立即採用。', explanation: '示例：一個更簡單嘅產品模式，可能同大型公司原有嘅收費或服務方式有衝突。實際情況仍要逐間公司核實。' },
      { title: '講優勢之前，先講清楚條件', body: '假設一項優勢只喺特定客群或規模先出現，就需要將條件一齊保留，避免將框架直接當成答案。', explanation: '示例：有大量用戶先出現嘅網絡效應，未必能幫到第一批用戶。討論時應講清楚適用階段。' },
    ],
  },
  {
    id: 'anthropic', series: "Lenny’s Podcast", guest: 'Mike Krieger · Anthropic',
    title: 'Anthropic’s CPO on what comes next', subtitle: 'AI 創辦人可以揀邊啲機會？',
    fullTitle: 'Anthropic’s CPO on what comes next | Mike Krieger', topic: '模型進步之後，產品機會喺邊？', date: '2025.06.05',
    videoId: 'DKrBGOFs0GY', official: 'https://www.lennysnewsletter.com/p/anthropics-cpo-heres-what-comes-next',
    start: '47:16', end: '52:03', excerpt: '4 分 47 秒', color: 'lavender', cover: 'WHAT’S NEXT', coverSub: 'THE MODEL COMPANY VIEW',
    overview: '從模型公司嘅角度，探索領域知識、接近客戶同互動方式，點樣幫創辦人選擇產品機會。',
    points: [
      { title: '領域知識，可以幫你揀對問題', body: '假設團隊熟悉一個行業嘅工作細節，就可能更早發現值得解決嘅問題；仍要向用戶確認需求。', explanation: '示例：熟悉一個工作流程，可以幫團隊提出更具體嘅問題，但熟悉行業唔等於已驗證付費意願。' },
      { title: '接近客戶，先知道工具漏咗乜', body: '假設團隊能持續觀察客戶點工作，就可以用回饋修正流程，而唔只係增加新功能。', explanation: '示例：請用戶示範一次真實任務，可能比直接問佢想要乜功能更容易見到困難。呢度係 UI 討論用例子。' },
      { title: '新能力，值得配一個新互動方式', body: '假設模型做到以前做唔到嘅工作，沿用舊介面未必最方便；可以先測試一個更直接嘅操作。', explanation: '示例：由填多個表格，改成先選一個任務再逐步補充資料。是否更好，仍要靠實際操作測試。' },
    ],
  },
];

export const byId = (id) => episodes.find((episode) => episode.id === id);
export function seconds(value) {
  if (!/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(value.trim())) return null;
  return value.trim().split(':').reduce((total, part) => total * 60 + Number(part), 0);
}
export function videoUrl(episode, timestamp) {
  return `https://www.youtube.com/watch?v=${episode.videoId}${timestamp ? `&t=${seconds(timestamp)}s` : ''}`;
}
export function episodeFromLink(value) {
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const host = url.hostname.replace(/^(www\.|m\.)/, '');
    const videoId = host === 'youtu.be' ? url.pathname.slice(1) : host === 'youtube.com' ? url.searchParams.get('v') : null;
    return episodes.find((episode) => episode.videoId === videoId || `${url.origin}${url.pathname}`.replace(/\/$/, '') === episode.official || (episode.id === 'yc' && host === 'open.spotify.com' && url.pathname === '/episode/6XqntsywWiJ6uDJQDkhksi')) || null;
  } catch { return null; }
}

export function createDemoState(id = 'choose') {
  const state = {
    screen: 'home', episodeId: 'cursor', link: '', error: '', expanded: null,
    baselineId: '', baselineLink: '', range: '', rangeStart: '19:30', rangeEnd: '31:24', compareError: '', goal: '',
  };
  if (id === 'link-error') return { ...state, link: 'https://example.com/episode', error: '呢個雛形只提供下方三集嘅示例，暫時未能處理其他連結。' };
  if (id === 'choose') return state;
  state.screen = 'overview';
  if (id === 'explanation') state.expanded = 0;
  if (id.startsWith('compare-')) state.screen = 'compare';
  if (id === 'compare-partial') Object.assign(state, { baselineId: 'yc', range: 'partial' });
  if (id === 'compare-unknown') Object.assign(state, { baselineId: 'yc', range: 'unknown' });
  if (id === 'compare-error') state.compareError = '請揀另一集作比較；貼連結暫時只支援本頁三集。';
  if (id === 'comparison' || id === 'source-difference') Object.assign(state, { screen: 'comparison', baselineId: 'yc', range: id === 'source-difference' ? 'unknown' : 'partial' });
  return state;
}
