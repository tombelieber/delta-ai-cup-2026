import React, { useEffect, useState } from 'react';
import { episodes, byId, seconds, videoUrl } from './data.js';
import { createAssistantState, comparisonPoints, thumbnails, formatTime, parseTime, mergeRanges, watchedSeconds, learningStats, getLearningRouteProgress, getHomeRecommendations, addWatchedRange, eligibleComparisonBaseline, openEpisodeState, homeState } from './assistant-data.js';
import './style.css';

function Icon({ name = 'arrow', size = 18, ...props }) {
  const paths = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    external: <path d="M14 4h6v6M20 4l-9 9M10 5H5v14h14v-5" />,
    play: <path d="m9 5 11 7-11 7V5Z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    plus: <path d="M12 5v14M5 12h14" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    sparkle: <><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z" /><path d="M21 3v4M19 5h4" /></>,
    memory: <><path d="M5 4h13a1 1 0 0 1 1 1v16l-7-4-7 4V4Z" /><path d="M9 8h6M9 11h6" /></>,
    chat: <path d="M5 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-9l-6 4V5a1 1 0 0 1 1-1Z" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    reset: <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />,
    edit: <path d="m15 4 5 5-10 10-6 1 1-6L15 4ZM13 6l5 5" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    send: <path d="m4 11 16-7-7 16-2-7-7-2ZM11 13l9-9" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    home: <><path d="m3 11 9-8 9 8v10h-6v-7H9v7H3V11Z" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
function Brand() { return <span className="assistant-brand"><span className="brand-mark"><i /><i /><i /><i /></span><strong>Delta</strong></span>; }
function SourceLink({ episode, time, children }) {
  return <a className="source-link" href={videoUrl(episode, time === undefined ? undefined : formatTime(time))} target="_blank" rel="noreferrer">{children}<Icon name="external" size={12} /></a>;
}
function Evidence({ episode, baseline, point, index }) {
  const old = baseline && byId(baseline.episodeId);
  const contentIndex = typeof index === 'number' ? index : 0;
  return <div className="point-evidence" id={`point-evidence-${index}`}>
    <p className="evidence-label">{baseline ? '點解咁分類？' : '內容說明'}</p><p>{baseline ? point.reason : episode.points[contentIndex].explanation}</p>
    <div className="evidence-source"><span className="source-dot current" /><div><small>今集候選章節</small><strong>{episode.title}</strong><SourceLink episode={episode} time={point.time}>{formatTime(point.time)} 開原片核對</SourceLink></div></div>
    {old && <div className="evidence-source"><span className="source-dot" /><div><small>已看基準 · {baseline.kind === 'sample' ? '示範記憶' : '此頁記錄'}</small><strong>{old.title}</strong><SourceLink episode={old} time={baseline.ranges[0][0]}>{formatTime(baseline.ranges[0][0])}–{formatTime(baseline.ranges[0][1])} 候選章節</SourceLink></div></div>}
    <p className="evidence-caveat">{baseline ? '分類及解釋' : '內容及解釋'}係虛構示例，並非講者引文；未經逐字稿核對。</p>
  </div>;
}

function LearningRoute({ route, onOpen }) {
  return <section id="learning-route" className="learning-section learning-route">
    <div className="learning-section-heading"><h3><span className="quest-step">02</span>示範觀看路線</h3><span>{route.completedSteps}/{route.totalSteps} 段已看完</span></div>
    <label className="route-progress-label" htmlFor="route-progress">觀看時間進度<strong>{route.percent}%</strong></label>
    <progress id="route-progress" max={route.totalSeconds} value={route.watchedSeconds} aria-label="示範觀看路線的觀看時間進度" aria-valuetext={`已看 ${route.watchedSeconds} 秒，共 ${route.totalSeconds} 秒；尚餘 ${route.remainingSeconds} 秒；${route.completedSteps} 段已看完`} />
    <p className="route-time-summary">已看 {formatTime(route.watchedSeconds)} / {formatTime(route.totalSeconds)}<span>尚餘 {formatTime(route.remainingSeconds)}</span></p>
    <div id="learning-next" className={`route-next ${route.complete ? 'is-complete' : ''}`}>
      {route.next ? <><p>路線下一步 <strong>{route.next.title}</strong></p><button id="route-next" onClick={() => onOpen(route.next.episodeId, route.next.time)}><Icon name="play" size={12} />繼續下一步 · {formatTime(route.next.time)}<Icon name="arrow" size={13} /></button></> : <><p><Icon name="check" size={14} /><strong>所選 3 段已看完，可以重溫。</strong></p><button id="route-rewatch" onClick={() => onOpen(route.steps[0].episodeId, route.steps[0].start)}>重溫已看片段<Icon name="reset" size={12} /></button></>}
    </div>
    <ol className="route-steps">{route.steps.map((step, index) => <li id={`route-step-${step.episodeId}`} key={step.episodeId} className={`route-step status-${step.status} ${step.isNext ? 'is-next' : ''}`} data-status={step.status} data-watched-seconds={step.watchedSeconds} data-remaining-seconds={step.remainingSeconds} aria-current={step.isNext ? 'step' : undefined}><span className="route-step-marker">{step.status === 'done' ? <Icon name="check" size={11} /> : index + 1}</span><div><div className="route-step-title"><strong>{step.title}</strong><span>{step.status === 'done' ? '已看完' : step.status === 'partial' ? step.isNext ? '部分已看 · 下一步' : '部分已看' : step.isNext ? '下一步' : '未開始'}</span></div><p>{formatTime(step.start)}–{formatTime(step.end)}<small>已看 {formatTime(step.watchedSeconds)}</small></p>{step.status === 'partial' && <p className="route-step-gap">未看：{step.gaps.map(([start, end]) => `${formatTime(start)}–${formatTime(end)}`).join('、')}</p>}</div></li>)}</ol>
    <p className="route-footnote">只計所選片段嘅觀看時間，唔代表已理解；開片、跳轉同重播唔會重複計。</p>
  </section>;
}

function LearningProgress({ state, patch, onOpen, onManage, compact = false }) {
  const entries = state.memory.filter((item) => mergeRanges(item.ranges).length);
  const stats = learningStats(entries);
  const sample = eligibleComparisonBaseline(entries, 'cursor');
  const route = getLearningRouteProgress(entries);
  function editGoal() {
    patch({ goalEditing: true, goalDraft: state.learningGoal });
    window.requestAnimationFrame(() => document.getElementById('goal-input')?.focus());
  }
  return <aside id="learning-sidebar" className={`learning-sidebar ${compact ? 'is-compact' : ''}`} aria-label="我的目標及已看足跡" tabIndex={-1}>
    <header className="learning-heading"><span className="learning-heading-icon"><Icon name="memory" size={16} /></span><div><h2>我的學習</h2><p>接住睇過嘅，繼續探索。</p></div><span className="learning-session-label">此頁暫存</span></header>
    <section id="learning-goal" className="learning-section learning-goal"><div className="learning-section-heading"><h3><span className="quest-step">01</span>目前目標</h3><span>{state.learningGoal ? state.goalKind === 'sample' ? '示範目標' : '此頁目標' : '選填'}</span></div>
      {state.goalEditing ? <form className="goal-editor" onSubmit={(event) => { event.preventDefault(); patch({ learningGoal: state.goalDraft.trim(), goalDraft: state.goalDraft.trim(), goalKind: 'manual', goalEditing: false }); }}><label htmlFor="goal-input">想透過睇片了解乜？</label><input id="goal-input" value={state.goalDraft} maxLength={100} onChange={(event) => patch({ goalDraft: event.target.value })} placeholder="例如：了解 AI 產品護城河" /><div className="goal-editor-actions"><button id="goal-save" type="submit">儲存目標<Icon name="check" size={12} /></button><button id="goal-cancel" type="button" onClick={() => patch({ goalEditing: false, goalDraft: state.learningGoal })}>取消</button></div></form> : <div className="goal-display"><strong>{state.learningGoal || '未設定目標'}</strong><button id="goal-edit" onClick={editGoal}><Icon name={state.learningGoal ? 'edit' : 'plus'} size={12} />{state.learningGoal ? '編輯' : '設定'}</button>{!state.learningGoal && <p>可以先揀片，之後再補。</p>}</div>}
      <p className="learning-goal-note">目標可留空；示範路線暫未按目標調整。</p>
    </section>
    <LearningRoute route={route} onOpen={onOpen} />
    <section id="learning-history" className="learning-section learning-history"><div className="learning-section-heading"><h3><span className="quest-step">03</span>已看足跡</h3>{entries.length > 0 && <button id="history-manage" onClick={onManage}>管理記錄<Icon name="arrow" size={12} /></button>}</div><p id="history-stats" className="learning-stats"><span id="learning-stats" data-segments={stats.segments} data-seconds={stats.seconds}>{stats.segments} 段 · 已看 {formatTime(stats.seconds)}</span><small>分:秒</small></p>
      <div id="home-watched" className="learning-history-list">{entries.length ? entries.map((entry) => { const episode = byId(entry.episodeId); const isAuthored = sample?.episodeId === entry.episodeId; return <article className="learning-history-item" id={`history-${entry.episodeId}`} key={entry.episodeId}><span className="history-timeline-dot" /><div><button id={`history-open-${entry.episodeId}`} className="history-episode" onClick={() => onOpen(entry.episodeId, entry.ranges[0][0])} title={`暫停重溫：${episode.title}`}>{isAuthored ? 'YC：AI 新創護城河' : episode.title}<Icon name="play" size={11} /></button><span className={`history-provenance ${entry.kind}`}>{entry.kind === 'sample' ? '示範記憶' : entry.kind === 'session' ? '此頁模擬播放' : '手動確認範圍'}</span><p className="history-ranges">{mergeRanges(entry.ranges).map(([start, end]) => <span key={`${start}-${end}`}>{formatTime(start)}–{formatTime(end)}</span>)}</p><p className="history-topic">{isAuthored ? '示例主題：轉換成本來自累積嘅工作。' : '有觀看記錄，範圍內講過乜仍未核對。'}</p></div></article>; }) : <div id="history-empty" className="learning-history-empty"><Icon name="memory" size={20} /><strong>未有已看記錄</strong><p>先揀一條片。模擬播放先會累積足跡，開片唔會自動當成已看。</p></div>}</div>
      <div id="home-memory-note" className="learning-history-note"><span>{entries.some((entry) => entry.kind === 'sample') ? '示範記憶唔係你嘅真實歷史。' : '只限記錄範圍。'}已看唔代表已理解。</span>{entries.length > 0 && state.page === 'home' && <button id="home-clear-memory" onClick={() => patch({ memory: [], messages: [], expandedPoint: null, homeExpandedId: null, recorded: false, playing: false })}>試首次使用</button>}</div>
    </section>
  </aside>;
}

function Home({ state, patch, onOpen, onManage, onReset, currentCase }) {
  const filtered = getHomeRecommendations(state.memory, state.homeQuery);
  const route = getLearningRouteProgress(state.memory);
  const recommendation = filtered[0];
  const alternatives = filtered.slice(1);
  const hasQuery = Boolean(state.homeQuery.trim());
  const hasMemory = state.memory.some((item) => item.ranges.length);
  const alternativesOpen = Boolean(state.homeAlternativesOpen || (state.homeExpandedId && state.homeExpandedId !== recommendation?.id));

  function recommendationCard(item, primary = false) {
    const stored = state.memory.find((entry) => entry.episodeId === item.id && entry.ranges.length);
    const baseline = eligibleComparisonBaseline(state.memory, item.id);
    const recorded = baseline || state.memory.find((entry) => entry.episodeId !== item.id && entry.ranges.length) || stored;
    const point = comparisonPoints(item.id)[0];
    const expanded = state.homeExpandedId === item.id;
    const personal = Boolean(baseline);
    const routeStep = route.steps.find((step) => step.episodeId === item.id);
    const rewatch = routeStep.status === 'done';
    const jumpTime = !hasQuery && primary ? routeStep.gaps[0]?.[0] ?? point.time : point.time;
    const reason = rewatch ? route.complete ? '所選三段嘅觀看範圍已覆蓋完成；有需要可以重溫產品做法，或者搜尋另一條示範影片。' : '呢個候選章節已看完，可以重溫；沿路線繼續時，會由未看過嘅部分開始。' : personal
      ? item.id === 'cursor'
        ? '有咗護城河框架，再接一個產品做法，幫你將概念連到實際設計。'
        : '接住護城河框架，轉去睇點樣用行業知識搵產品機會。'
      : stored
        ? '呢集有一段已看記錄，可以由候選章節重溫；其餘內容未作判斷。'
        : recorded
          ? '先用今集做內容導覽；記錄範圍嘅內容未核對，暫時未作個人比較。'
        : item.id === 'cursor'
          ? '由一個具體 AI 產品入手，容易將工作流程同產品價值連起來；依家係一般入門選擇。'
          : item.overview;
    const additions = rewatch ? [route.complete ? '所選三段已看完' : '呢個候選章節已看完', '依家可以重溫候選片段，唔會將重播再計一次進度。'] : personal && item.id === 'cursor'
      ? ['由單次生成，到整個修改流程', 'Cursor 工作流程示例：將「轉換成本」落到具體產品做法。']
      : personal
        ? ['由競爭優勢到產品機會', '用行業工作細節，補一個揀產品問題嘅角度。']
        : [item.points[0].title, '內容導覽示例，未作個人比較；未判斷對你有幾多新增。'];
    return <article key={item.id} id={primary ? 'home-recommendation' : undefined} className={`home-video-card ${primary ? 'home-primary-card' : 'home-alternative-card'} ${expanded ? 'is-expanded' : ''}`}>
      <div className="home-poster-column"><button id={`open-video-${item.id}`} className="home-thumbnail-button" onClick={() => onOpen(item.id)} aria-label={`開啟 ${item.title} 嘅觀看示範`}><img src={thumbnails[item.id]} alt={`${item.title} 官方影片縮圖`} /><span className="home-thumbnail-play"><Icon name="play" size={23} /></span><span className="home-chapter-badge">候選章節 {item.start}–{item.end}</span></button>{primary && <p className="home-poster-caption"><Icon name="clock" size={14} /><span>先睇呢段 · {item.excerpt}</span><span>時間待核對</span></p>}</div>
      <div className="home-decision">
        <div className="home-recommendation-label"><span><Icon name={rewatch || stored && !personal ? 'memory' : 'sparkle'} size={14} />{rewatch ? '所選章節已看完 · 可重溫' : primary ? '示範推薦' : '另一個選擇'}</span>{primary && <small>{rewatch ? '觀看進度，唔代表理解' : personal ? '人工比較示例' : stored ? '部分已看 · 可重溫' : recorded ? '已看範圍尚未核對' : '一般入門選擇'}</small>}</div>
        <div className="home-video-meta"><h2>{item.title}</h2><p>{item.guest} <span>·</span> {item.series}</p></div>
        {primary ? <div className={`home-learning-path ${personal ? 'has-comparison' : ''}`}>
          <section id="home-adds" className="home-path-step"><h3><Icon name="plus" size={13} />{rewatch ? '可以重溫' : personal ? '今集新增' : '今集可睇'}</h3><div><strong>{personal && !rewatch && <span className="home-addition-tag">延伸</span>}{additions[0]}</strong><p>{additions[1]}</p></div></section>
          <section id="home-next-reason" className="home-path-step home-path-reason"><h3><Icon name="arrow" size={13} />{rewatch ? '接住可以點' : '點解下一條睇佢'}</h3><div><p>{reason}</p></div></section>
        </div> : <div className={`home-reason ${personal ? 'has-comparison' : ''}`}><h3>點解推薦呢集？</h3><p>{reason}</p></div>}
        <div className="home-card-actions"><button id={`home-jump-${item.id}`} className="home-jump" onClick={() => onOpen(item.id, jumpTime)} aria-label={`${rewatch ? '重溫' : '由'} ${formatTime(jumpTime)} 開啟 ${item.title} 嘅觀看示範`}><Icon name="play" size={14} />{rewatch ? '重溫' : '由'} {formatTime(jumpTime)} {rewatch ? '片段' : '開始睇'}<Icon name="arrow" size={16} /></button></div>
        {primary && <p className="home-comparison-context">{rewatch ? '此章節已看完，重溫唔會增加觀看覆蓋進度。' : baseline ? '相對右邊 YC 已看片段嘅比較示意。' : recorded ? '已看範圍尚未核對，暫未作個人比較。' : '未有已看記錄，依家係一般入門選擇。'}</p>}
        <button className="home-evidence-toggle" id={`home-evidence-${item.id}`} aria-expanded={expanded} aria-controls={`home-comparison-${item.id}`} onClick={() => patch({ homeExpandedId: expanded ? null : item.id })}>{expanded ? '收起推薦依據' : personal ? '睇推薦依據' : '睇內容說明'}<Icon name="chevron" size={14} className={expanded ? 'rotated' : ''} /></button>
        {expanded && <div id={`home-comparison-${item.id}`} className="home-expanded-evidence"><Evidence episode={item} baseline={baseline} point={point} index={`home-${item.id}`} /></div>}
      </div>
    </article>;
  }
  return <div className="watch-app home-app" data-case={currentCase}>
    <div className="prototype-strip"><span><span className="status-dot" />互動原型 <b>·</b> YouTube 首頁情境</span><span>固定示例 · 未連接 YouTube 或 AI</span></div>
    <header className="watch-header home-header">
      <div className="youtube-context"><Icon name="menu" size={20} /><span className="youtube-wordmark"><span><Icon name="play" size={14} /></span>YouTube<sup>HK</sup></span></div>
      <form className="home-search" role="search" onSubmit={(event) => event.preventDefault()}><label className="sr-only" htmlFor="home-search">搜尋示範影片</label><input id="home-search" value={state.homeQuery} onChange={(event) => patch({ homeQuery: event.target.value, homeAlternativesOpen: Boolean(event.target.value.trim()), homeExpandedId: null })} placeholder="搜尋影片、主題或講者" autoComplete="off" /><span aria-hidden="true"><Icon name="search" size={19} /></span></form>
      <button id="demo-reset" className="reset-button" onClick={onReset}><Icon name="reset" size={15} /><span>重設示範</span></button>
    </header>
    <div className="home-layout">
      <aside className="home-rail" aria-label="目前位置"><span className="home-rail-active"><Icon name="home" size={22} /><span>首頁</span></span><span className="home-rail-brand"><span className="brand-mark"><i /><i /><i /><i /></span><span>Delta</span></span></aside>
      <div className="home-workspace"><main className="home-content">
        <section className="home-intro" aria-labelledby="home-heading"><div className="home-eyebrow"><Brand /><span>{route.complete && !hasQuery ? '所選片段已看完，隨時返嚟重溫。' : '幫你揀下一條值得睇嘅片。'}</span></div><h1 id="home-heading">{hasQuery ? '搜尋結果，先睇呢集。' : route.complete ? '所選三段已看完，可以重溫。' : hasMemory ? '下一條，推薦你睇呢集。' : '由呢集開始。'}</h1>{hasQuery && <p className="home-search-count">{filtered.length} 條符合嘅示範影片</p>}<a className="learning-mobile-link" href="#learning-sidebar"><Icon name="memory" size={13} />我的目標／已看<Icon name="arrow" size={13} /></a></section>
        {recommendation ? <>{recommendationCard(recommendation, true)}{alternatives.length > 0 && <details id="home-alternatives" className="home-alternatives" open={alternativesOpen} onToggle={(event) => { if (event.currentTarget.open !== alternativesOpen) patch({ homeAlternativesOpen: event.currentTarget.open, ...(!event.currentTarget.open ? { homeExpandedId: null } : {}) }); }}><summary><span>其他選擇 <small>（{alternatives.length}）</small></span><Icon name="chevron" size={16} /></summary><div className="home-alternative-grid">{alternatives.map((item) => recommendationCard(item))}</div></details>}</> : <section className="home-empty-state" aria-live="polite"><span><Icon name="search" size={31} /></span><h2>未搵到呢條示範影片</h2><p>而家只收錄 Cursor、YC 同 Anthropic 三條影片。試下其他講者或主題。</p><button id="home-search-clear" className="subtle-button" onClick={() => patch({ homeQuery: '', homeAlternativesOpen: false })}>返回示範推薦<Icon name="arrow" size={15} /></button></section>}
        <p className="home-disclosure">固定推薦及虛構分析，供討論體驗；未連接 YouTube 或 AI。時間只係待核對嘅候選章節。</p>
      </main><LearningProgress state={state} patch={patch} onOpen={onOpen} onManage={onManage} /></div>
    </div>
  </div>;
}

export default function App({ initialState }) {
  const [state, setState] = useState(() => ({ ...createAssistantState(), ...initialState }));
  const patch = (next) => setState((previous) => ({ ...previous, ...next }));
  const episode = byId(state.episodeId) || episodes[0];
  const chapterStart = seconds(episode.start), chapterEnd = seconds(episode.end);
  const points = comparisonPoints(episode.id);
  const baseline = eligibleComparisonBaseline(state.memory, episode.id);
  const currentMemory = state.memory.find((item) => item.episodeId === episode.id);
  const watchCase = state.collapsed ? 'assistant-collapsed' : state.editMemoryId ? 'memory-edit' : state.tab === 'memory' ? 'memory' : state.tab === 'chat' && state.messages.length ? 'chat-answer' : !baseline ? 'no-history' : state.expandedPoint !== null ? 'point-evidence' : state.recorded ? 'recorded' : 'watching';
  const homeSelection = getHomeRecommendations(state.memory, state.homeQuery)[0];
  const routeProgress = getLearningRouteProgress(state.memory);
  const currentCase = state.page === 'home' ? state.goalEditing ? 'home-goal-edit' : !homeSelection ? 'home-empty' : !state.memory.length ? 'home-no-history' : state.homeExpandedId ? 'home-evidence' : routeProgress.complete ? 'home-route-complete' : state.routeFixture ? 'home-route-partial' : !eligibleComparisonBaseline(state.memory, homeSelection.id) ? 'home-unverified-history' : 'home' : watchCase;

  useEffect(() => {
    if (!state.playing || state.page !== 'watch') return undefined;
    // One real elapsed second adds one simulated watched second. Seeking never
    // fills the skipped interval, and hidden tabs pause the simulation.
    const timer = window.setInterval(() => setState((previous) => {
      if (!previous.playing || previous.page !== 'watch') return previous;
      const end = seconds(byId(previous.episodeId).end);
      const next = Math.min(previous.time + 1, end);
      return { ...previous, time: next, playing: next < end, recorded: next > previous.time || previous.recorded,
        memory: addWatchedRange(previous.memory, previous.episodeId, previous.time, next) };
    }), 1000);
    const onVisibility = () => { if (document.hidden) setState((previous) => ({ ...previous, playing: false })); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [state.playing, state.page]);

  function openVideo(id, time) {
    setState((previous) => openEpisodeState(previous, id, time));
    window.requestAnimationFrame(() => { window.scrollTo(0, 0); document.getElementById('assistant-tab-new')?.focus({ preventScroll: true }); });
  }
  function backToHome() {
    setState(homeState);
    window.requestAnimationFrame(() => { window.scrollTo(0, 0); document.getElementById(`open-video-${episode.id}`)?.focus({ preventScroll: true }); });
  }
  function manageMemory() {
    patch({ page: 'watch', tab: 'memory', collapsed: false, playing: false, editMemoryId: null, memoryError: '' });
    window.requestAnimationFrame(() => { window.scrollTo(0, 0); document.getElementById('assistant-tab-memory')?.focus({ preventScroll: true }); });
  }

  function switchEpisode(id) {
    patch({ episodeId: id, time: seconds(byId(id).start), playing: false, expandedPoint: null, messages: [], chatInput: '', editMemoryId: null, recorded: false, seekMessage: '' });
  }
  function seek(time, fromPoint = false) {
    patch({ time: Math.min(chapterEnd, Math.max(chapterStart, Number(time))), playing: false,
      seekMessage: fromPoint ? '已定位到示例時間；跳過嘅部分唔會當成已看。' : '已移動模擬播放位置；未播放部分唔會記錄。' });
  }
  function selectTab(tab) { patch({ tab, editMemoryId: null, memoryError: '' }); }
  function openMemoryEditor(item) {
    const id = item?.episodeId || episodes.find((candidate) => !state.memory.some((memory) => memory.episodeId === candidate.id))?.id || episode.id;
    const selected = byId(id);
    patch({ tab: 'memory', editMemoryId: item ? id : 'new', editEpisodeId: id,
      rangeStart: item ? formatTime(item.ranges[0][0]) : selected.start,
      rangeEnd: item ? formatTime(item.ranges[0][1]) : selected.end, memoryError: '' });
  }
  function saveMemory(event) {
    event.preventDefault();
    const selected = byId(state.editEpisodeId);
    const start = parseTime(state.rangeStart), end = parseTime(state.rangeEnd);
    if (start === null || end === null || end <= start) { patch({ memoryError: '請輸入有效時間，例如 19:30–31:24；結束時間需要較遲。' }); return; }
    if (start < seconds(selected.start) || end > seconds(selected.end)) { patch({ memoryError: `呢個原型只支援候選章節 ${selected.start}–${selected.end}，請在範圍內修改。` }); return; }
    const previous = state.memory.find((item) => item.episodeId === selected.id);
    const entry = { episodeId: selected.id, ranges: [[start, end]], kind: previous?.kind === 'sample' ? 'sample' : 'manual' };
    patch({ memory: [...state.memory.filter((item) => item.episodeId !== selected.id), entry], editMemoryId: null, memoryError: '', tab: 'memory', messages: [], expandedPoint: null });
  }
  function sendQuestion(question, quick = false) {
    const text = question.trim();
    if (!text) return;
    const answer = quick ? baseline
      ? `可以先留意「${points[0].title}」呢個${points[0].type}示例。${points[0].body} 呢個係預設答案，用嚟討論助手點樣提供比較依據。`
      : '而家未有內容已核對嘅比較基準，只可以做今集內容導覽，未能判斷邊啲對你係新。觀看範圍記錄仍會保留。'
      : '呢個互動原型未連接 AI，暫時未能回答自由輸入問題。你可以撳上方示範問題，睇有來源嘅回答會點呈現。';
    patch({ tab: 'chat', chatInput: '', editMemoryId: null, messages: [...state.messages, { role: 'user', text }, { role: 'assistant', text: answer, canned: quick && Boolean(baseline) }] });
  }
  function collapse(value) {
    patch({ collapsed: value });
    window.requestAnimationFrame(() => document.getElementById(value ? 'assistant-open' : 'assistant-collapse')?.focus());
  }

  if (state.page === 'home') return <Home state={state} patch={patch} onOpen={openVideo} onManage={manageMemory} onReset={() => setState(createAssistantState())} currentCase={currentCase} />;

  return <div className={`watch-app ${state.collapsed ? 'sidebar-is-collapsed' : ''}`} data-case={currentCase}>
    <div className="prototype-strip"><span><span className="status-dot" />互動原型 <b>·</b> YouTube 側欄情境</span><span>模擬播放 · 示意論點 · 未連接 AI</span></div>
    <header className="watch-header">
      <div className="youtube-context"><button id="back-to-home" className="back-to-home" onClick={backToHome} aria-label="返回揀片首頁"><Icon name="arrow" size={17} /><span>揀片</span></button><span className="youtube-wordmark"><span><Icon name="play" size={14} /></span>YouTube<sup>HK</sup></span><span className="context-label">觀看情境</span></div>
      <div className="episode-switch"><label htmlFor="video-select">示範影片</label><select id="video-select" value={episode.id} onChange={(event) => switchEpisode(event.target.value)}>{episodes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
      <button id="demo-reset" className="reset-button" onClick={() => setState(createAssistantState())}><Icon name="reset" size={15} /><span>重設示範</span></button>
    </header>
    <main className="watch-layout">
      <section className="video-column" aria-label="YouTube 觀看情境">
        <div className="mock-player" aria-label="示例播放器，並非真實影片播放">
          <img src={thumbnails[episode.id]} className="video-thumbnail" alt={`${episode.title} 官方影片縮圖`} />
          <div className="player-shade" /><span className="mock-badge"><span />模擬播放</span>
          {!state.playing && <button className="center-play" aria-label="開始模擬播放" onClick={() => patch({ playing: true, time: state.time >= chapterEnd ? chapterStart : state.time, seekMessage: '' })}><Icon name="play" size={28} /></button>}
          {state.playing && <div className="playing-message"><span className="sound-bars"><i /><i /><i /></span><span>模擬時間前進中<small>唔會播放影片或聲音</small></span></div>}
          <div className="player-controls"><input id="demo-seek" type="range" min={chapterStart} max={chapterEnd} step="1" value={state.time} onChange={(event) => seek(event.target.value)} aria-label="模擬播放位置" aria-valuetext={formatTime(state.time)} style={{ '--progress': `${((state.time - chapterStart) / (chapterEnd - chapterStart)) * 100}%` }} /><div className="player-control-row"><button id="demo-play" className="player-play" onClick={() => patch({ playing: !state.playing, time: state.time >= chapterEnd ? chapterStart : state.time, seekMessage: '' })} aria-label={state.playing ? '暫停模擬播放' : '開始模擬播放'}><Icon name={state.playing ? 'pause' : 'play'} size={20} /></button><span className="player-time">{formatTime(state.time)} <b>/ {episode.end}</b></span><span className="chapter-label">候選章節</span><SourceLink episode={episode} time={state.time}>開啟原片</SourceLink></div></div>
        </div>
        <div className="video-title-row"><div><p className="video-kicker">{episode.series} <span>·</span> {episode.date}</p><h1>{episode.title}</h1>{!state.collapsed && <a className="learning-mobile-link" href="#learning-sidebar"><Icon name="memory" size={13} />我的目標／已看<Icon name="arrow" size={13} /></a>}</div>{state.collapsed && <button id="assistant-open" className="open-assistant" onClick={() => collapse(false)}><Icon name="sparkle" /><span>開啟 Delta 助手</span><Icon name="panel" size={16} /></button>}</div>
        <div className="channel-row"><span className={`channel-avatar ${episode.id}`}>{episode.id === 'yc' ? 'Y' : 'L'}</span><div><strong>{episode.series}</strong><span>{episode.guest}</span></div><SourceLink episode={episode}>YouTube 原片</SourceLink></div>
        <div className="watch-context-note"><div className="context-note-title"><Icon name="clock" size={16} /><strong>你繼續睇，Delta 幫你接返之前睇過嘅內容。</strong></div><p>候選章節 {episode.start}–{episode.end}。撳播放可試記錄幾秒，再去「已看記憶」查看；拖動進度條唔會將跳過部分當成已看。</p>{state.seekMessage && <p className="seek-notice" role="status">{state.seekMessage}</p>}<div id="recording-status" className={`recording-status ${state.playing ? 'active' : ''}`} role="status"><span className="status-dot" />{currentMemory ? `今集已記錄 ${watchedSeconds(currentMemory.ranges)} 秒 · 只限此頁暫存` : '今集未有觀看記錄'}{state.playing && ' · 模擬記錄中'}</div></div>
        <div className="up-next-heading"><h2>換一條片，助手跟住轉</h2><span>同一組示範記憶</span></div><div className="related-videos">{episodes.filter((item) => item.id !== episode.id).map((item) => <button className="related-video" key={item.id} onClick={() => switchEpisode(item.id)}><img src={thumbnails[item.id]} alt="" /><span><small>{item.series}</small><strong>{item.title}</strong><span>{item.guest}</span></span><Icon name="arrow" size={16} /></button>)}</div>
        <p className="page-disclosure">討論用 web 原型，未安裝 extension。論點、比較及問答均為虛構示例；原片連結只開啟待核對嘅候選章節。重整頁面會還原示範記憶。</p>
      </section>

      {!state.collapsed && <aside className="assistant-panel" aria-label="Delta YouTube 助手">
        <header className="assistant-header"><div><Brand /><span className="assistant-descriptor">你嘅 YouTube 助手</span></div><button id="assistant-collapse" className="icon-button" aria-label="收起 Delta 助手" onClick={() => collapse(true)}><Icon name="panel" size={19} /></button></header>
        <LearningProgress state={state} patch={patch} onOpen={openVideo} onManage={manageMemory} compact />
        <div className="assistant-context"><span className="context-connected"><span />跟住今條片</span><strong>{episode.title}</strong></div>
        <div className="assistant-tabs" role="tablist" aria-label="助手功能">{[['new', '新意', 'sparkle'], ['chat', '問助手', 'chat'], ['memory', '已看記憶', 'memory']].map(([id, label, icon], index, tabs) => <button key={id} id={`assistant-tab-${id}`} className={state.tab === id ? 'active' : ''} role="tab" aria-selected={state.tab === id} aria-controls={`panel-${id}`} tabIndex={state.tab === id ? 0 : -1} onClick={() => selectTab(id)} onKeyDown={(event) => { if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; selectTab(tabs[next][0]); document.getElementById(`assistant-tab-${tabs[next][0]}`)?.focus(); } }}><Icon name={icon} size={15} />{label}</button>)}</div>

        {state.tab === 'new' && <section id="panel-new" role="tabpanel" aria-labelledby="assistant-tab-new" className="assistant-body novelty-panel">
          {baseline ? <><div className="novelty-heading"><p className="section-eyebrow">相對已看內容 · 比較示意</p><h2>今集，多咗啲乜？</h2><p>先睇值得留意嘅角度，再決定睇邊段。</p></div><button className="baseline-pill" onClick={() => selectTab('memory')}><span className="baseline-icon"><Icon name="memory" size={16} /></span><span><small>{baseline.kind === 'sample' ? '示範記憶' : '已看基準'} · {formatTime(baseline.ranges[0][0])}–{formatTime(baseline.ranges[0][1])}</small><strong>{byId(baseline.episodeId).title}</strong></span><Icon name="chevron" size={14} /></button></> : <div className="no-history" id="no-history-note"><span className="empty-memory-icon"><Icon name="sparkle" size={22} /></span><p className="section-eyebrow">由今條片開始</p><h2>先探索，慢慢累積記憶。</h2><p>{state.memory.length ? '有觀看範圍記錄，但內容未核對，暫時只做內容導覽，未作個人比較。' : '未有另一集已看內容，依家只做內容導覽，唔會判斷邊啲對你係新。'}</p><button className="subtle-button" onClick={() => openMemoryEditor()}>加入已看範圍<Icon name="plus" size={14} /></button></div>}
          <div className="point-list">{points.map((point, index) => <article className={`insight-card type-${index} ${state.expandedPoint === index ? 'is-expanded' : ''}`} key={`${episode.id}-${index}`} data-point={index}><div className="insight-card-meta"><span className={`relation-tag relation-${index}`}>{baseline ? point.type : '導覽示例'}</span><button className="point-jump" id={`jump-point-${index}`} onClick={() => seek(point.time, true)} aria-label={`定位到 ${formatTime(point.time)}，${point.title}`}><Icon name="play" size={11} />{formatTime(point.time)}</button></div><h3>{point.title}</h3><p>{baseline ? point.body : episode.points[index].body}</p><div className="insight-card-actions"><span>{baseline ? '個人用處未判斷' : '未判斷個人新增程度'}</span><button id={`evidence-${index}`} aria-expanded={state.expandedPoint === index} onClick={() => patch({ expandedPoint: state.expandedPoint === index ? null : index })}>{state.expandedPoint === index ? '收起依據' : baseline ? '睇比較依據' : '睇內容說明'}<Icon name="chevron" size={13} className={state.expandedPoint === index ? 'rotated' : ''} /></button></div>{state.expandedPoint === index && <Evidence episode={episode} baseline={baseline} point={point} index={index} />}</article>)}</div>
          {baseline && <details className="repeated-points"><summary><span><span className="repeated-dot" />重複內容示例<small>有需要先重溫</small></span><Icon name="chevron" size={14} /></summary><div><strong>累積嘅工作，可能形成轉換成本</strong><p>如果主張、理由同適用條件相同，只係換個講法，仍然歸為重複。</p><SourceLink episode={episode} time={chapterStart}>今集候選章節</SourceLink><SourceLink episode={byId(baseline.episodeId)} time={baseline.ranges[0][0]}>已看候選章節</SourceLink></div></details>}
          <button className="ask-invitation" id="ask-compare" onClick={() => sendQuestion('同我之前睇過嘅，有乜唔同？', true)}><span><Icon name="chat" size={16} />想再問深一啲？</span><Icon name="arrow" size={17} /></button><p className="sidebar-footnote">示意比較，未分析真實影片；時間點係候選章節。</p>
        </section>}

        {state.tab === 'chat' && <section id="panel-chat" role="tabpanel" aria-labelledby="assistant-tab-chat" className="assistant-body chat-panel"><div className="novelty-heading"><p className="section-eyebrow">由依家睇緊嘅內容問起</p><h2>想釐清邊一點？</h2><p>回答會連返片段，同相關嘅已看記憶。</p></div><div className="quick-questions"><button id="ask-compare" onClick={() => sendQuestion('同我之前睇過嘅，有乜唔同？', true)}><Icon name="sparkle" size={14} />同之前睇過嘅，有乜唔同？</button><button onClick={() => sendQuestion('解釋依家呢個角度', true)}><Icon name="play" size={13} />解釋依家呢個角度</button></div><div className="chat-messages" aria-live="polite">{state.messages.length === 0 ? <div className="chat-empty"><Icon name="chat" size={30} /><p>試撳一條示範問題。</p><small>自由輸入亦可以試；原型未連接 AI。</small></div> : state.messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index} id={message.role === 'assistant' && index === state.messages.length - 1 ? 'chat-answer' : undefined}>{message.role === 'assistant' && <span className="answer-label"><Icon name="sparkle" size={13} />{message.canned ? '預設示範回答' : '原型提示'}</span>}<p>{message.text}</p>{message.canned && <div className="chat-sources"><SourceLink episode={episode} time={points[0].time}>今集 {formatTime(points[0].time)}</SourceLink>{baseline && <SourceLink episode={byId(baseline.episodeId)} time={baseline.ranges[0][0]}>已看 {formatTime(baseline.ranges[0][0])}</SourceLink>}</div>}</div>)}</div><form className="chat-composer" onSubmit={(event) => { event.preventDefault(); sendQuestion(state.chatInput); }}><label className="sr-only" htmlFor="chat-input">問 Delta 助手</label><input id="chat-input" value={state.chatInput} onChange={(event) => patch({ chatInput: event.target.value })} placeholder="問依家呢條片…" maxLength={500} /><button id="chat-send" type="submit" aria-label="送出問題" disabled={!state.chatInput.trim()}><Icon name="send" size={17} /></button></form><p className="sidebar-footnote">問答未連接 AI；示範回答唔係節目分析。</p></section>}

        {state.tab === 'memory' && <section id="panel-memory" role="tabpanel" aria-labelledby="assistant-tab-memory" className="assistant-body memory-panel"><div className="novelty-heading"><p className="section-eyebrow">比較，由你睇過嘅範圍開始</p><h2>已看記憶</h2><p>只記錄確認過嘅部分，唔會假設睇過全集。</p></div><div className="memory-privacy-note"><Icon name="memory" size={16} /><p>全部只喺此頁暫存。預載 YC 係示範記憶，唔係你嘅 YouTube 歷史。</p></div>
          {state.editMemoryId ? <form className="memory-editor" onSubmit={saveMemory} noValidate><div className="memory-editor-heading"><h3>{state.editMemoryId === 'new' ? '加入已看範圍' : '修改已看範圍'}</h3><button type="button" className="icon-button" aria-label="取消修改" onClick={() => patch({ editMemoryId: null, memoryError: '' })}><Icon name="close" size={16} /></button></div><label htmlFor="memory-episode">影片</label><select id="memory-episode" value={state.editEpisodeId} disabled={state.editMemoryId !== 'new'} onChange={(event) => { const item = byId(event.target.value); patch({ editEpisodeId: item.id, rangeStart: item.start, rangeEnd: item.end, memoryError: '' }); }}>{episodes.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select><div className="memory-time-inputs"><label htmlFor="memory-start">開始時間<input id="memory-start" value={state.rangeStart} onChange={(event) => patch({ rangeStart: event.target.value, memoryError: '' })} placeholder="19:30" inputMode="numeric" aria-invalid={Boolean(state.memoryError)} aria-describedby={state.memoryError ? 'memory-error' : 'memory-range-help'} /></label><span>—</span><label htmlFor="memory-end">結束時間<input id="memory-end" value={state.rangeEnd} onChange={(event) => patch({ rangeEnd: event.target.value, memoryError: '' })} placeholder="31:24" inputMode="numeric" aria-invalid={Boolean(state.memoryError)} aria-describedby={state.memoryError ? 'memory-error' : 'memory-range-help'} /></label></div><p id="memory-range-help" className="field-help">候選章節 {byId(state.editEpisodeId).start}–{byId(state.editEpisodeId).end}。儲存會以呢段取代該集現有範圍。</p>{state.memoryError && <p id="memory-error" className="form-error" role="alert">{state.memoryError}</p>}<button id="memory-save" type="submit" className="primary-button">確認範圍<Icon name="check" size={15} /></button></form> : <><div id="memory-list" className="memory-list">{state.memory.length === 0 ? <div className="memory-empty"><Icon name="memory" size={28} /><h3>未有已看記憶</h3><p>可以模擬播放幾秒，或者手動加入範圍。</p></div> : state.memory.map((item) => { const stored = byId(item.episodeId); return <article className="memory-card" key={item.episodeId}><div className="memory-card-top"><img src={thumbnails[item.episodeId]} alt="" /><div><span className={`memory-kind ${item.kind}`}>{item.kind === 'sample' ? '示範記憶' : item.kind === 'session' ? '模擬播放記錄' : '手動確認示例'}</span><h3>{stored.title}</h3></div></div><div className="memory-ranges">{mergeRanges(item.ranges).map(([start, end]) => <span key={`${start}-${end}`}><Icon name="check" size={12} />{formatTime(start)}–{formatTime(end)}</span>)}</div><div className="memory-card-bottom"><span>{watchedSeconds(item.ranges)} 秒 · {item.episodeId === episode.id ? '今集' : '可作比較基準'}</span><button id={`memory-edit-${item.episodeId}`} onClick={() => openMemoryEditor(item)}><Icon name="edit" size={13} />修改</button><button aria-label={`移除 ${stored.title} 嘅記憶`} onClick={() => patch({ memory: state.memory.filter((entry) => entry.episodeId !== item.episodeId), messages: [], expandedPoint: null })}>移除</button></div></article>; })}</div><button id="memory-add" className="add-memory" onClick={() => openMemoryEditor()}><Icon name="plus" size={16} />加入另一段已看內容</button>{state.memory.length > 0 && <button id="memory-clear" className="clear-memory" onClick={() => patch({ memory: [], tab: 'new', recorded: false, expandedPoint: null, playing: false, messages: [] })}>清除記憶，試首次使用</button>}</>}
          <p className="sidebar-footnote">未讀取你嘅 YouTube 歷史；重新整理會還原示範。</p>
        </section>}
      </aside>}
    </main>
  </div>;
}
