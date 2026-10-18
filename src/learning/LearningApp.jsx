import React, { useEffect, useRef, useState } from 'react';
import { ArrowRightIcon, ArrowLeftIcon, CheckIcon, ReaderIcon, TriangleUpIcon, MixerHorizontalIcon, ExternalLinkIcon, FileTextIcon, PlayIcon, ChevronRightIcon, ChevronDownIcon, ChevronLeftIcon, CopyIcon, Pencil2Icon, Cross2Icon } from '@radix-ui/react-icons';
import './learning.css';

const KEY = 'delta-learning-next-discussion-v2';
const MATERIALS = [
  { id: 'practice', icon: 'ƒx', label: '實作練習', note: '自己寫一次公式，核對結果。', meta: '一個任務 · 約 3 分鐘', screen: 'practice' },
  { id: 'slides', icon: '▤', label: '投影片 / PPT', note: '用圖解同例子，逐頁睇明。', meta: '4 張投影片 · 隨時翻頁', screen: 'learn-slides' },
  { id: 'video', icon: '▷', label: '教學短片', note: '跟住畫面同字幕重溫概念。', meta: '互動分鏡 · 未生成影片', screen: 'learn-video' },
];
const SLIDES = [
  { tag: '01 / 04 · 問題', title: '總收入，唔等於\n香港分店嘅收入。', text: '四筆銷售來自唔同城市。只想知道香港收入，就要先篩選，再加總。', emphasis: '先揀啱，再加埋。' },
  { tag: '02 / 04 · 概念', title: 'SUMIF：\n有條件先加。', text: '逐行睇城市。符合「香港」嘅一行，先將同一行嘅銷售額加入總數。', emphasis: '條件範圍 → 條件 → 加總範圍' },
  { tag: '03 / 04 · 例子', title: '香港兩筆收入，\n合共 $1,200。', text: '香港 $500 ＋ 香港 $700 = $1,200。東京同台北唔計入今次答案。', emphasis: '=SUMIF(A2:A5, "香港", B2:B5)' },
  { tag: '04 / 04 · 延伸', title: '換個條件，\n公式可以點改？', text: '想計東京收入，就將條件改成「東京」。城市欄同銷售額欄可以保持一樣。', emphasis: '範圍不變，只改條件。' },
];
const BASE = { theme: 'cats', language: '廣東話', level: '新手', short: true, goal: '用 SUMIF 計出香港分店收入', formula: '', watched: true, understood: false, verified: false, prefRevision: 0, interestIds: [], interestSource: null };
const STATUS = { ready: '已備妥', idle: '已備妥', generating: '已備妥 · 更新中', error: '已備妥 · 更新可重試' };
function Icon({ type = 'arrow', ...props }) {
  const Component = { arrow: ArrowRightIcon, check: CheckIcon, back: ArrowLeftIcon, book: ReaderIcon }[type] || ArrowRightIcon;
  return <Component width="18" height="18" aria-hidden="true" {...props} />;
}
const INTERESTS = [
  { id: 'ai-products', input: 'ai', label: 'AI 產品與創業', scene: 'AI 工具商店' },
  { id: 'cats', input: 'cats', label: '貓咪與咖啡店', scene: '貓咪咖啡店' },
  { id: 'gaming', input: 'gaming', label: '遊戲與道具', scene: '遊戲道具商店' },
];
const SAMPLE_HISTORY = [
  { title: 'AI 產品點樣揀第一個用戶', topic: 'AI 產品與創業', range: '12:10–18:40' },
  { title: '由 AI 工具到一門小生意', topic: 'AI 產品與創業', range: '23:37–24:53' },
  { title: '貓咪咖啡店嘅一日', topic: '貓咪與咖啡店', range: '02:00–06:00' },
  { title: '遊戲道具商店點樣運作', topic: '遊戲與道具', range: '04:20–08:10' },
];
function makeData(initialScreen, initialResources) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  const statuses = { practice: 'ready', slides: 'ready', video: 'ready', ...initialResources };
  if (initialScreen === 'learn-video') statuses.video = 'ready';
  if (initialScreen === 'generation-running') statuses.video = 'generating';
  if (initialScreen === 'generation-error') statuses.video = 'error';
  if (initialScreen === 'on-demand') Object.keys(statuses).forEach((id) => { statuses[id] = 'idle'; });
  const resources = Object.fromEntries(MATERIALS.map(({ id }) => {
    const stored = saved.resources?.[id];
    const state = stored && ['ready', 'idle', 'generating', 'error'].includes(stored.status) ? { ...stored, status: stored.status === 'generating' ? 'error' : stored.status, available: stored.available ?? stored.status === 'ready' } : { status: statuses[id], revision: 0, available: true };
    if (state.status === 'idle' || !state.available && state.status !== 'ready') state.status = 'ready';
    state.available = true;
    return [id, state];
  }));
  return { ...BASE, ...saved, resources,
    ...(initialScreen === 'interest-applied' && !saved.resources ? { theme: 'ai-products', interestIds: ['ai-products'], interestSource: 'sample-confirmed' } : {}),
    ...(initialScreen === 'feedback' && !saved.resources ? { formula: '=SUM(B2:B5)', verified: false } : {}),
    ...(initialScreen === 'complete' && !saved.resources ? { formula: '=SUMIF(A2:A5,"香港",B2:B5)', verified: true, understood: false } : {}),
  };
}
export default function LearningApp({ initialScreen = 'youtube-entry', initialResources, freezeGeneration = false }) {
  const [screen, setScreen] = useState(initialScreen);
  const [data, setData] = useState(() => makeData(initialScreen, initialResources));
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [interestsOpen, setInterestsOpen] = useState(initialScreen === 'interest-review');
  const [showInterestSuggestions, setShowInterestSuggestions] = useState(initialScreen === 'interest-review');
  const [interestDraft, setInterestDraft] = useState(initialScreen === 'interest-review' ? [] : data.interestIds || []);
  const preferenceTrigger = useRef(null);
  const [slide, setSlide] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoFrame, setVideoFrame] = useState(0);
  const [inlineChecked, setInlineChecked] = useState(false);
  const [quiz, setQuiz] = useState('');
  const [notice, setNotice] = useState('');
  const [returnToPractice, setReturnToPractice] = useState(false);
  const generationTimers = useRef({});
  const themeName = INTERESTS.find((item) => item.id === data.theme)?.scene || '貓咪咖啡店';
  const selectedInterests = INTERESTS.filter((item) => (data.interestIds || []).includes(item.id));
  const interestLabel = selectedInterests.map((item) => item.label).join('、');
  const onWatchPage = ['youtube-entry', 'interest-review', 'interest-applied'].includes(screen);
  const selected = ['practice', 'feedback', 'complete'].includes(screen) ? 'practice' : screen === 'learn-slides' ? 'slides' : screen === 'learn-video' ? 'video' : null;
  const patch = (change) => setData((old) => ({ ...old, ...change }));
  const resourcePatch = (id, change) => setData((old) => ({ ...old, resources: { ...old.resources, [id]: { ...old.resources[id], ...change } } }));
  const patchPreference = (change) => setData((old) => ({ ...old, ...change, prefRevision: old.prefRevision + 1 }));
  const go = (next) => { setScreen(next); setPlaying(false); setNotice(''); requestAnimationFrame(() => { const target = ['practice', 'feedback', 'complete', 'learn-slides', 'learn-video'].includes(next) ? document.getElementById('material-content') : document.getElementById(next === 'youtube-entry' ? 'assistant-result' : 'next-section'); if (target) { target.scrollIntoView({ block: 'start', behavior: 'instant' }); target.focus({ preventScroll: true }); } else window.scrollTo({ top: 0, behavior: 'instant' }); }); };
  const available = (id) => data.resources[id].status === 'ready' || data.resources[id].available;
  const openPreferences = () => { preferenceTrigger.current = document.activeElement?.id; setPreferencesOpen(true); requestAnimationFrame(() => document.getElementById('learning-goal-input')?.focus()); };
  const closePreferences = () => { setPreferencesOpen(false); requestAnimationFrame(() => document.getElementById(preferenceTrigger.current || 'edit-preferences')?.focus()); };
  const generate = (id) => resourcePatch(id, { status: 'generating', available: available(id) });
  const openMaterial = (item, { existing = false } = {}) => { if (data.resources[item.id].status === 'ready' || existing && available(item.id)) go(item.screen); else if (data.resources[item.id].status !== 'generating') generate(item.id); };
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(data)); }, [data]);
  useEffect(() => {
    MATERIALS.forEach(({ id }) => {
      const pending = data.resources[id].status === 'generating' && !(freezeGeneration && id === 'video');
      if (pending && !generationTimers.current[id]) generationTimers.current[id] = setTimeout(() => {
        delete generationTimers.current[id];
        setData((old) => ({ ...old, resources: { ...old.resources, [id]: { status: 'ready', revision: old.prefRevision, available: true } } }));
      }, 1800);
      if (!pending && generationTimers.current[id]) { clearTimeout(generationTimers.current[id]); delete generationTimers.current[id]; }
    });
  }, [data.resources, freezeGeneration]);
  useEffect(() => () => Object.values(generationTimers.current).forEach(clearTimeout), []);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setVideoFrame((old) => { if (old >= 3) { setPlaying(false); return 3; } return old + 1; }), 5000);
    return () => clearInterval(timer);
  }, [playing]);
  const validate = () => {
    const normalized = data.formula.trim().replace(/\s/g, '').replace(/；/g, ';').replace(/;/g, ',').replace(/[“”]/g, '"').toUpperCase();
    const passed = /^=SUMIF\(\$?A\$?2:\$?A\$?5,"香港",\$?B\$?2:\$?B\$?5\)$/.test(normalized);
    patch({ verified: passed }); go(passed ? 'complete' : 'feedback');
  };
  const formulaIsSum = /^=SUM\(B2:B5\)$/i.test(data.formula.replace(/\s/g, ''));
  const openInterests = () => { setPreferencesOpen(false); setInterestDraft(data.interestIds || []); setShowInterestSuggestions(false); setInterestsOpen(true); requestAnimationFrame(() => document.getElementById('suggest-interests')?.focus()); };
  const closeInterests = () => { setInterestsOpen(false); requestAnimationFrame(() => document.getElementById('open-interests')?.focus()); };
  const applyInterests = () => {
    const ids = INTERESTS.filter((item) => interestDraft.includes(item.id)).map((item) => item.id);
    setData((old) => ({ ...old, interestIds: ids, interestSource: ids.length ? 'sample-confirmed' : null, theme: ids[0] || 'cats', prefRevision: old.prefRevision + 1 }));
    closeInterests();
  };
  function InterestPanel() {
    return <section id="interest-panel" className="dl-preference-panel dl-interest-panel" role="dialog" aria-modal="false" aria-labelledby="interest-title" onKeyDown={(event) => { if (event.key === 'Escape') closeInterests(); }}><div className="dl-section-head"><h3 id="interest-title">用你嘅興趣出題</h3><button id="close-interests" className="dl-text-button" onClick={closeInterests}>略過</button></div><p>從觀看記錄建議主題，再由你確認或修改。學習目標不變，練習例子更貼近你。</p><p className="dl-interest-disclosure">示例模式 · 本原型未讀取真實紀錄。</p><button id="suggest-interests" className="dl-secondary" onClick={() => setShowInterestSuggestions(true)}>用示例觀看記錄建議興趣</button>{showInterestSuggestions && <><details className="dl-interest-history"><summary>查看建議依據 · 4 段示例</summary>{SAMPLE_HISTORY.map((item) => <div key={item.title}><strong>{item.title}</strong><small>{item.range} · {item.topic}</small></div>)}</details><fieldset id="interest-tags"><legend>確認想用嘅興趣，可複選或略過</legend>{INTERESTS.map((item) => <label key={item.id}><input id={`interest-${item.input}`} type="checkbox" checked={interestDraft.includes(item.id)} onChange={(event) => setInterestDraft((old) => event.target.checked ? [...old, item.id] : old.filter((id) => id !== item.id))} /><span>{item.label}</span><small>{item.id === 'ai-products' ? '2 段示例' : '1 段示例'}</small></label>)}</fieldset><p className="dl-small">只改練習情境；唔會將興趣當成已理解或已學識。</p><button id="apply-interests" className="dl-primary" onClick={applyInterests}>套用到練習</button></>}{selectedInterests.length > 0 && <button id="clear-interests" className="dl-text-button" onClick={() => { setData((old) => ({ ...old, interestIds: [], interestSource: null, theme: 'cats', prefRevision: old.prefRevision + 1 })); setInterestDraft([]); closeInterests(); }}>清除興趣，使用一般教材情境</button>}</section>;
  }
  function Preferences() {
    return <section className="dl-preference-panel" role="dialog" aria-modal="false" aria-label="共用學習偏好" onKeyDown={(event) => { if (event.key === "Escape") closePreferences(); }}><div className="dl-section-head"><h3>今次學習嘅共用偏好</h3><button id="save-preferences" className="dl-text-button" onClick={closePreferences}>完成</button></div><div className="dl-preferences">
      <div className="dl-field dl-goal-field"><label htmlFor="learning-goal-input">學習目標 <small>選填</small></label><input id="learning-goal-input" maxLength="120" value={data.goal} placeholder="可以留空，直接用教材" onChange={(event) => patchPreference({ goal: event.target.value })} /></div>
      <div className="dl-field"><label htmlFor="dl-theme">例子情境</label><select id="dl-theme" value={data.theme} onChange={(event) => patchPreference({ theme: event.target.value })}><option value="ai-products">AI 工具商店</option><option value="cats">貓咪咖啡店</option><option value="gaming">遊戲道具商店</option></select></div>
      <div className="dl-field"><label htmlFor="dl-language">語言偏好</label><select id="dl-language" value={data.language} onChange={(event) => patchPreference({ language: event.target.value })}><option>廣東話</option><option>繁體中文</option><option>English</option></select></div>
      <div className="dl-field"><label htmlFor="dl-level">程度</label><select id="dl-level" value={data.level} onChange={(event) => patchPreference({ level: event.target.value })}><option>新手</option><option>有少少基礎</option></select></div>
      <label className="dl-check"><input type="checkbox" checked={data.short} onChange={(event) => patchPreference({ short: event.target.checked })} />盡量 5 分鐘內</label>
      <p className="dl-small">三項共用呢啲偏好；現有教材可保留或各自重新生成。討論稿仍使用固定廣東話示例，未接 AI。</p>
    </div></section>;
  }
  function Quest({ sidebar = false }) {
    const evidence = [['watched', '有觀看記錄', data.watched, '00:00–02:10 · 示範範圍'], ['understood', '理解概念', data.understood, data.understood ? '答對 SUM / SUMIF 概念題' : '未有概念題通過記錄'], ['practice', '實作驗證', data.verified, data.verified ? '公式、條件與結果已核對' : '未有公式驗證通過記錄']];
    return <aside className={`dl-quest ${sidebar ? 'on-youtube' : ''}`} aria-label="學習進度"><span className="dl-eyebrow">YOUR PROGRESS · 分開記錄</span><h2>{data.goal || '未設定學習目標'}</h2><p className="dl-muted">目標選填 · 今次係 SUMIF 示例</p><div className="dl-quest-total"><span>已有證據</span><strong>{evidence.filter((item) => item[2]).length} / 3</strong></div><progress id="learning-progress" aria-label="已有證據嘅學習項目" max="3" value={evidence.filter((item) => item[2]).length} /><ol className="dl-steps">{evidence.map(([id, label, done, note], index) => <li id={`evidence-${id}`} data-complete={String(done)} className={done ? 'done' : ''} key={id}><span className="dl-step-dot">{done ? <Icon type="check" width="12" height="12" /> : index + 1}</span><div><strong>{label}</strong><small>{note}</small></div></li>)}</ol><p className="dl-small">觀看範圍唔代表已理解。開啟或生成教材，亦唔會自動完成任何項目。</p></aside>;
  }
  function CoreResult({ compact = false }) {
    if (compact) return <section id="assistant-result" className="dx-brief" tabIndex={-1} aria-label="Delta 片段摘要"><div className="dx-section-label"><span>片段摘要</span><span>02:10–04:35</span></div><h2>SUMIF：篩選後加總。</h2><p className="dx-brief-copy">只選「香港」兩行，再加銷售額：<strong>$1,200</strong>。</p><div className="dx-formula"><code>=SUMIF(A2:A5, "香港", B2:B5)</code><button id="copy-formula" aria-label="複製公式" onClick={async () => { try { await navigator.clipboard.writeText('=SUMIF(A2:A5,"香港",B2:B5)'); setNotice("已複製公式。"); } catch { setNotice("未能複製，請選取公式文字。"); } }}><CopyIcon /></button></div><div className="dx-delta"><div><span>已睇</span><strong>SUM · 全部加總</strong></div><div><span>新增</span><strong>SUMIF · 加入條件</strong></div></div><button id="watch-next" className="dx-watch-link" onClick={() => setNotice('原片時間碼入口示意：02:10。呢個原型未嵌入真實影片。')}>02:10 <span>睇原片核對</span><ExternalLinkIcon /></button></section>;
    return <section className={`dl-assistant-result ${compact ? 'compact' : ''}`} id="assistant-result" tabIndex={-1} aria-label="Delta 助手結果"><div className="dl-result-heading"><span className="dl-eyebrow">DELTA · 由已睇，揀下一段</span><span className="dl-example-label">分析示例</span></div><h2>下一段，補上「有條件先加」。</h2><div className="dl-result-items"><section><span>01</span><div><h3>你已睇過乜</h3><p>SUM 會將範圍內所有數字加總。</p><small>示範已看 · 00:00–02:10</small></div></section><section><span>02</span><div><h3>呢段新增乜</h3><p>SUMIF 加入條件，先揀出香港，再計收入。</p><small>新做法 · 02:10–04:35</small></div></section><section><span>03</span><div><h3>點解接住睇</h3><p>由「全部加埋」，延伸到「只計符合條件嘅數字」。</p></div></section></div><button className="dl-primary dl-watch-next" id="watch-next" onClick={() => { go('youtube-entry'); setNotice('原片入口示意：由 02:10 繼續。呢個原型未嵌入真實影片。'); }}>由 02:10 睇下一段 <Icon /></button></section>;
  }
  function SourceContext() {
    return <div className="dl-next-context" id="learning-source"><div className="dl-source-thumb">SUM<span>IF</span></div><div><span className="dl-eyebrow">同一份原片內容</span><strong>Excel SUMIF 入門：有條件加總</strong><small>示範來源 · 02:10–04:35</small><p>{data.goal || '未設定目標'} · {data.language} · {data.level}</p></div><button className="dl-text-button" id="edit-preferences" onClick={openPreferences}>調整目標 / 偏好</button></div>;
  }
  const checkInline = () => {
    const normalized = data.formula.trim().replace(/\s/g, '').replace(/;/g, ',').replace(/[“”]/g, '"').toUpperCase();
    patch({ verified: /^=SUMIF\(\$?A\$?2:\$?A\$?5,"香港",\$?B\$?2:\$?B\$?5\)$/.test(normalized) });
    setInlineChecked(true);
  };
  function InlineMaterial(id) {
    if (id === 'practice') return <div className="dl-inline-material dl-inline-practice"><div className="dl-inline-task"><strong id="task-interest-context">{themeName} · 只計香港收入</strong><p id="interest-question-context">{selectedInterests.length ? `情境示例：幫${themeName}計出香港地區嘅收入。` : "教材示例：只計香港地區嘅收入。"}</p><p>香港 500 · 東京 300<br />香港 700 · 台北 200</p></div><label htmlFor="inline-practice-formula">直接寫公式</label><input id="inline-practice-formula" value={data.formula} placeholder={'=SUMIF(A2:A5,"香港",B2:B5)'} spellCheck={false} onChange={(event) => { patch({ formula: event.target.value, verified: false }); setInlineChecked(false); }} /><button className="dl-primary" id="inline-check-formula" onClick={checkInline}>核對公式</button><p id="inline-practice-feedback" role="status">{data.verified ? '✓ 香港收入 $1,200，公式通過。' : inlineChecked ? formulaIsSum ? 'SUM 計咗所有城市 $1,700；試加香港條件。' : '試用 SUMIF，寫入城市、香港條件及銷售額範圍。' : '可以直接做；唔使先睇教材。'}</p></div>;
    if (id === 'slides') return <div className="dl-inline-material"><div className="dl-inline-slide"><span className="dl-eyebrow">{SLIDES[slide].tag}</span><h4>{SLIDES[slide].title}</h4><p>{SLIDES[slide].text}</p><code>{SLIDES[slide].emphasis}</code></div><div className="dl-inline-controls"><button id="inline-prev-slide" aria-label="上一張投影片" disabled={slide === 0} onClick={() => setSlide(slide - 1)}><ChevronLeftIcon /></button><span id="inline-slide-page">{slide + 1} / 4</span><button id="inline-next-slide" aria-label="下一張投影片" disabled={slide === 3} onClick={() => setSlide(slide + 1)}><ChevronRightIcon /></button></div></div>;
    return <div className="dl-inline-material"><div className="dl-inline-video"><span className="dl-eyebrow">教學短片 · 分鏡示例</span><strong>SUM<span>IF</span></strong><h4>{SLIDES[videoFrame].title}</h4><p>{SLIDES[videoFrame].text}</p></div><div className="dl-inline-controls"><button id="inline-play-video" onClick={() => { if(videoFrame === 3) setVideoFrame(0); setPlaying(!playing); }}>{playing ? 'Ⅱ 暫停' : '▷ 播放示例'}</button><span id="inline-video-page">{videoFrame + 1} / 4</span></div><small>現階段係分鏡預覽，未生成影片／旁白。</small></div>;
  }
  function SidebarLearning() {
    const done = Number(data.watched) + Number(data.understood) + Number(data.verified);
    return <section id="next-section" className="dx-learning" tabIndex={-1} aria-label="已備妥學習內容"><div className="dx-learning-head"><span className="dx-section-label">學習內容</span><div><button id="edit-preferences" onClick={openPreferences} aria-label="學習偏好"><MixerHorizontalIcon /></button><button id="launch-learning" onClick={() => go('next-overview')} aria-label="展開全部學習內容"><ExternalLinkIcon /></button></div></div><div id="learning-source" className="dx-learning-source"><strong>有條件加總 · SUMIF</strong><span>三份已備妥</span></div><div className="dx-interest-hint"><span id="confirmed-interests">{interestLabel ? `興趣情境：${interestLabel}` : "未設定興趣"}</span><button id="open-interests" onClick={openInterests}>{interestLabel ? "修改" : "用觀看記錄建議"}</button></div><article id="next-card-slides" data-status={data.resources.slides.status} data-available="true" className="dx-ppt-card"><div className="dx-ppt-head"><h3>投影片 / PPT</h3><span id="resource-status-slides">已備妥</span><button id="next-slides" onClick={() => go('learn-slides')} aria-label="放大投影片"><ExternalLinkIcon /></button></div>{InlineMaterial('slides')}</article><div className="dx-small-resources">{MATERIALS.filter((item) => item.id !== 'slides').map((item) => <article id={`next-card-${item.id}`} key={item.id} data-status={data.resources[item.id].status} data-available="true"><details id={`sidebar-${item.id}`}><summary id={`sidebar-${item.id}-toggle`}><span className="dx-resource-icon">{item.id === "practice" ? <Pencil2Icon /> : <PlayIcon />}</span><strong>{item.label}</strong><span id={`resource-status-${item.id}`}>已備妥</span><ChevronRightIcon className="dx-disclosure-arrow" /></summary><div className="dx-small-content">{InlineMaterial(item.id)}<button id={`next-${item.id}`} className="dx-inline-expand" onClick={() => go(item.screen)}>放大檢視 ↗</button></div></details></article>)}</div><details id="sidebar-progress" className="dx-progress"><summary><ReaderIcon /><span>學習證據</span><strong>{done} / 3</strong><ChevronRightIcon /></summary>{Quest({ sidebar: true })}</details></section>;
  }
  function NextSection({ compact = false }) {
    if (compact) return SidebarLearning();
    return <section className={`dl-next-extension ${compact ? 'compact' : ''}`} id="next-section" tabIndex={-1} aria-label="下一步延伸"><div className="dl-next-heading"><div><span className="dl-eyebrow">NEXT · 三份內容已備妥</span><h2>三份內容已準備好，即刻用。</h2><p>直接做練習、翻投影片或播放短片示例。</p></div>{compact && <button id="launch-learning" className="dl-text-button" onClick={() => go('next-overview')}>展開詳細頁 ↗</button>}</div>{SourceContext()}<div className="dl-next-grid">{MATERIALS.map((item) => {
      const resource = data.resources[item.id];
      const stale = resource.revision !== data.prefRevision;
      return <article id={`next-card-${item.id}`} key={item.id} data-status={resource.status} data-available="true" className="dl-next-card"><div className="dl-card-top"><span className="dl-material-icon">{item.icon}</span><span className={`dl-resource-status ${resource.status}`} id={`resource-status-${item.id}`} role="status">{STATUS[resource.status]}</span></div><h3>{item.label}</h3><p>{item.note}</p>{InlineMaterial(item.id)}<button id={`next-${item.id}`} className="dl-text-button dl-expand-material" onClick={() => go(item.screen)}>放大檢視 ↗</button>{stale && <small className="dl-stale">偏好已更新；現有內容繼續可用。</small>}{stale && resource.status === 'ready' && <button id={`regenerate-${item.id}`} className="dl-text-button" onClick={() => generate(item.id)}>更新呢份內容</button>}{resource.status === 'error' && <button id={`retry-${item.id}`} className="dl-text-button" onClick={() => generate(item.id)}>重試更新</button>}{resource.status !== 'ready' && <button id={`open-existing-${item.id}`} className="dl-text-button" onClick={() => go(item.screen)}>放大現有版本</button>}{freezeGeneration && item.id === 'video' && resource.status === 'generating' && <button id="finish-video" className="dl-text-button" onClick={() => resourcePatch('video', { status: 'ready', revision: data.prefRevision, available: true })}>完成示範更新</button>}</article>;
    })}</div><p className="dl-small dl-material-note">三份內容均已放喺頁面，毋須選定一種先開始。全部係 UX 示例；PPT 未匯出，短片為可播放分鏡。</p></section>;
  }
  function SalesTable({ filtered = false }) {
    return <div className="dl-sheet interactive"><div className="dl-sheet-name"><span>▦</span>{themeName} · 銷售紀錄<span>示例資料</span></div><table><thead><tr><th></th><th>A</th><th>B</th></tr></thead><tbody><tr><th>1</th><td className="dl-cell-heading">城市</td><td className="dl-cell-heading">銷售額 HK$</td></tr>{[['香港', 500], ['東京', 300], ['香港', 700], ['台北', 200]].map(([city, amount], index) => <tr key={index} className={filtered ? city === '香港' ? 'dl-row-match' : 'dl-row-dim' : ''}><th>{index + 2}</th><td>{city}</td><td>{amount.toLocaleString()}</td></tr>)}</tbody></table><div className="dl-sheet-foot">{filtered ? '只計香港：500 + 700 = 1,200' : '任務：只加總城市為「香港」嘅銷售額'}</div></div>;
  }
  function QuickCheck() {
    return <section className="dl-quiz"><span className="dl-eyebrow">選做 · 理解確認</span><h3>{selectedInterests.length ? `喺${themeName}，只計香港收入應該用邊個？` : "只想計香港收入，應該用邊個？"}</h3><div className="dl-quiz-options">{['SUM', 'SUMIF'].map((answer) => <button key={answer} id={`answer-${answer.toLowerCase()}`} className={quiz === answer ? answer === 'SUMIF' ? 'correct' : 'incorrect' : ''} onClick={() => { setQuiz(answer); patch({ understood: answer === 'SUMIF' }); }}>{answer}{quiz === answer && (answer === 'SUMIF' ? ' ✓' : ' · 再諗一諗')}</button>)}</div>{quiz && <p className={quiz === 'SUMIF' ? 'dl-good' : 'dl-small'}>{quiz === 'SUMIF' ? '概念題通過。實作驗證仍然獨立記錄。' : 'SUM 會加晒所有城市；今次需要先判斷條件。'}</p>}</section>;
  }
  function Detail() {
    if (!selected) return <>{screen === 'library' && <button className="dl-secondary" id="resume-learning" onClick={() => go(data.verified ? 'complete' : 'practice')}>放大上次練習 <Icon /></button>}{QuickCheck()}</>;
    if (selected === 'practice') return <section id="material-content" tabIndex={-1} className="dl-open-material" aria-label="實作練習"><div className="dl-lesson-heading"><div><span className="dl-eyebrow">PRACTICE · 實作練習</span><h1>{screen === 'complete' ? '今次公式，通過驗證。' : '試下自己計出 $1,200。'}</h1><p className="dl-muted">{themeName} · 唔使先睇完投影片</p></div></div>{screen === 'complete' ? <><div className="dl-complete"><div className="dl-success-mark"><Icon type="check" width="30" height="30" /></div><div className="dl-result"><span>香港分店收入</span><strong>HK$1,200</strong><code>{data.formula}</code></div><p>公式使用正確城市範圍、香港條件及銷售額範圍。</p><p className="dl-small">只記錄今次固定練習通過，唔代表其他題目或概念題已通過。</p><div className="dl-complete-actions"><button className="dl-primary" id="save-learning" onClick={() => go('library')}>保存並稍後繼續 <Icon /></button><button className="dl-secondary" id="edit-formula" onClick={() => go('practice')}>修改公式</button></div></div>{QuickCheck()}</> : <><div className="dl-task-banner"><span>YOUR TASK</span><p>只計香港：500 + 700。請用公式寫出篩選同加總方法。</p></div>{SalesTable({})}<label className="dl-formula-label" htmlFor="practice-formula">你嘅公式 <span>數字答案唔足夠，試寫一次公式</span></label><div className="dl-formula-field"><span>ƒx</span><input id="practice-formula" value={data.formula} onChange={(event) => patch({ formula: event.target.value, verified: false })} spellCheck={false} placeholder={'例如：=SUMIF(條件範圍,"香港",加總範圍)'} /></div><div className="dl-practice-actions"><button id="review-example" className="dl-text-button" onClick={() => { if (available('slides')) { setReturnToPractice(true); setSlide(2); go('learn-slides'); } else setNotice('投影片未就緒，可喺上方獨立生成。提示：A2:A5 搵城市，B2:B5 加收入，條件係香港。'); }}>睇返相關例子 <Icon /></button><button className="dl-primary" id="check-formula" onClick={validate}>核對公式 <Icon type="check" /></button></div>{screen === 'feedback' && <div className="dl-feedback" role="status"><span className="dl-feedback-icon">!</span><div><span className="dl-eyebrow">再試一次</span><h2>{formulaIsSum ? '你計咗所有城市：$1,700。' : '試用 SUMIF，將條件寫入公式。'}</h2><p>目標只計香港。A2:A5 搵城市，B2:B5 先係加總嘅銷售額。你嘅公式已保留，可以直接改。</p></div></div>}{QuickCheck()}</>}</section>;
    const pageIndex = selected === 'video' ? videoFrame : slide;
    const setPage = selected === 'video' ? setVideoFrame : setSlide;
    return <section id="material-content" tabIndex={-1} className="dl-open-material" aria-label={selected === 'slides' ? '投影片教材' : '教學短片分鏡'}><div className="dl-lesson-heading"><div><span className="dl-eyebrow">{selected === 'slides' ? 'SLIDES · 投影片' : 'VIDEO · 教學短片分鏡'}</span><h1>有條件先加：SUMIF</h1><p className="dl-muted">{themeName} · 固定廣東話示例教材</p></div></div><section className={`dl-slide-stage ${selected === 'video' ? 'video' : ''}`}><div className="dl-slide-content"><div className="dl-slide-copy"><span className="dl-eyebrow">{SLIDES[pageIndex].tag}</span><h2>{SLIDES[pageIndex].title}</h2><p>{SLIDES[pageIndex].text}</p><div className="dl-concept">{SLIDES[pageIndex].emphasis}</div></div>{SalesTable({ filtered: pageIndex >= 1 })}</div>{selected === 'video' && <div className="dl-caption"><span>字幕分鏡</span>{SLIDES[pageIndex].text}</div>}<div className="dl-stage-controls">{selected === 'video' ? <button id="play-storyboard" className="dl-secondary" onClick={() => { if (pageIndex === 3) setPage(0); setPlaying(!playing); }}>{playing ? 'Ⅱ 暫停分鏡' : '▷ 播放分鏡'}</button> : <button className="dl-icon-button" aria-label="上一頁" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}><Icon type="back" /></button>}<span className="dl-small">{pageIndex + 1} / 4</span><button id="next-slide" className="dl-icon-button" aria-label="下一頁" disabled={pageIndex === 3} onClick={() => setPage(pageIndex + 1)}><Icon /></button></div></section><div className="dl-lesson-tools"><button onClick={() => setNotice('討論稿未產生 PPT、影片或其他可下載檔案。')}>下載教材 ↗</button><span className="dl-small">{selected === 'video' ? '只有分鏡預覽，未生成影片或旁白。' : '投影片預覽，未產生 PPT 檔。'}</span></div>{returnToPractice && <div className="dl-retry-banner"><div><strong>你嘅公式仲喺度。</strong><p>睇完例子，可以返去修改。</p></div><button id="back-to-practice" className="dl-primary" onClick={() => { setReturnToPractice(false); go('practice'); }}>返去改公式 <Icon /></button></div>}{QuickCheck()}</section>;
  }
  return <div className="dl-app dl-next-app" data-case={screen}>
    <div className="dl-prototype"><span>UX 討論稿 · 全部為示例</span><span>未連接真實觀看紀錄或 AI 教材生成</span></div>
    {onWatchPage ? <><header className="dl-yt-header"><div className="dl-yt-logo"><span>▶</span>YouTube</div><div className="dl-yt-search">Excel SUMIF 教學 <span>⌕</span></div><span className="dl-avatar">K</span></header><div className="dl-yt-layout"><main className="dl-yt-main"><div className="dl-yt-player" id="youtube-player"><div className="dl-player-grid" /><div className="dl-player-label">EXCEL ESSENTIALS <span>示例影片情境</span></div><div className="dl-player-content"><span className="dl-player-chip">一個公式，篩選再加總</span><h1>SUM<span>IF</span></h1><p>只計你需要嘅數字。</p><div className="dl-player-formula">=SUMIF(範圍, 條件, 加總範圍)</div></div><div className="dl-yt-controls"><span>▷</span><span>02:10 / 12:40</span><div /><span>⚙</span></div></div><h2 className="dl-yt-title">Excel SUMIF 入門：有條件加總，一次搞清楚</h2><div className="dl-yt-channel"><span className="dl-channel-avatar">E</span><div><strong>Excel 每日一課</strong><small>教學影片 · 示範來源</small></div></div><div className="dl-yt-description"><strong>Delta 接住你睇過嘅內容，幫你揀下一步。</strong><p>右邊先睇片段摘要同新增重點；投影片已展開，練習同短片隨時可用。</p></div></main><aside className="dl-yt-side dx-watch-sidebar"><div className="dx-sidebar-brand"><span className="dx-brand-mark"><TriangleUpIcon /></span><div className="dx-brand-copy"><strong>Delta</strong><span>YouTube 助手</span></div><button id="watch-settings" className="dx-sidebar-action" aria-label="調整學習偏好" onClick={openPreferences}><MixerHorizontalIcon /></button></div>{CoreResult({ compact: true })}{NextSection({ compact: true })}</aside></div></> : <><header className="dl-header"><button id="return-assistant" className="dl-brand" onClick={() => go('youtube-entry')}><span className="dl-brand-symbol">Δ</span>Delta<span className="dl-header-caption">助手結果 / 下一步</span></button><nav><button id="open-library" onClick={() => go('library')}><Icon type="book" />我的進度</button></nav></header><div className="dl-workspace"><nav className="dl-breadcrumb"><button onClick={() => go('youtube-entry')}>YouTube 助手</button><span>/</span><strong>今次結果嘅下一步</strong></nav>{selected && <nav className="dl-material-switch" aria-label="切換下一步內容"><button id="back-next" onClick={() => go("next-overview")}>← 助手結果</button>{MATERIALS.map((item) => <button id={`switch-${item.id}`} key={item.id} aria-pressed={selected === item.id} onClick={() => go(item.screen)}>{item.label}<small>{STATUS[data.resources[item.id].status]}</small></button>)}</nav>}<div className="dl-learning-layout"><main>{CoreResult({})}{NextSection({})}{Detail()}</main>{Quest({})}</div></div></>}
    {preferencesOpen && Preferences()}
    {interestsOpen && InterestPanel()}
    {notice && <div className="dl-toast" id={notice.startsWith('投影片未就緒') ? 'material-hint' : undefined} role="status"><span>{notice}</span><button aria-label="關閉提示" onClick={() => setNotice('')}>×</button></div>}
  </div>;
}
