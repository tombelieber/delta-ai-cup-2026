import React, { useState } from 'react';
import { episodes } from '../src/data.js';
import { formatTime, getLearningRouteProgress, mergeRanges, watchedSeconds } from '../src/assistant-data.js';
import ValueAnalysis from './ValueAnalysis.jsx';
import { LearningWorkspace } from '../src/learning/LiveLearningApp.jsx';
import { LEARNING_PILOT, learningSourceVideo } from './learning-source.js';
import './sidebar.css';

const emptyData = { schemaVersion: 1, recordingEnabled: true, goal: '', videos: {} };
const statusText = {
  playing: '正在記錄實播片段', paused: '已暫停，進度保留', buffering: '緩衝中，暫停記錄',
  ad: '廣告播放中，暫停記錄', seeking: '跳轉中，跳過嘅部分唔計',
  waiting: '等候影片播放', unavailable: '暫時未能讀取播放器',
};
const timeRange = ([start, end]) => `${formatTime(start)}–${formatTime(end)}`;
function cleanRanges(ranges = [], duration = 0) {
  return mergeRanges(ranges.filter((item) => Array.isArray(item) && item.length === 2)
    .map(([start, end]) => [start, duration > 0 ? Math.min(end, duration) : end]));
}
function coverage(video) {
  const duration = Number.isFinite(video?.duration) && video.duration > 0 ? video.duration : 0;
  const ranges = cleanRanges(video?.ranges, duration);
  const watched = watchedSeconds(ranges);
  const gaps = [];
  let cursor = 0;
  if (duration) {
    for (const [start, end] of ranges) {
      if (start > cursor) gaps.push([cursor, start]);
      cursor = Math.max(cursor, end);
    }
    if (cursor < duration) gaps.push([cursor, duration]);
  }
  return { duration, ranges, watched, gaps, percent: duration ? Math.min(100, Math.floor(watched / duration * 100)) : 0 };
}
function CoverageBar({ id, value, max, label }) {
  return <progress id={id} className="zx-progress" value={value} max={max || 1} aria-label={label}
    aria-valuetext={`${formatTime(value)}／${formatTime(max)}`} />;
}

export default function Sidebar({ data = emptyData, live = null, error = '', onToggleRecording = () => {}, onGoalChange = () => {}, onOpenVideo = () => {}, onRetry = () => {}, initialGoalEditing = false,
  analysis = null, analysisBusy = false, analysisError = '', onAnalyze = () => {}, onCancelAnalyze = null, apiEndpoint = '', onEndpointChange = null,
  learningClient = null, learningStorage = null }) {
  const stored = data || emptyData;
  const videos = stored.videos || {};
  const [editingGoal, setEditingGoal] = useState(initialGoalEditing);
  const [goalDraft, setGoalDraft] = useState(stored.goal || '');
  const [pending, setPending] = useState('');
  const [actionError, setActionError] = useState('');
  const current = live?.videoId ? { ...videos[live.videoId], videoId: live.videoId,
    duration: videos[live.videoId]?.duration || live.duration,
    title: live.title || videos[live.videoId]?.title || 'YouTube 影片' } : null;
  const currentCoverage = coverage(current);
  const memory = episodes.map((episode) => ({ episodeId: episode.id, ranges: videos[episode.videoId]?.ranges || [] }));
  const route = getLearningRouteProgress(memory);
  const history = Object.values(videos).filter((video) => cleanRanges(video.ranges).length)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const shownError = error || actionError;
  const recording = stored.recordingEnabled !== false;
  const status = !recording ? 'recording-off' : (live?.status || 'waiting');
  const run = async (name, callback) => {
    setPending(name); setActionError('');
    try { await callback(); return true; }
    catch { setActionError('操作未能儲存，請重試。現有記錄仍會保留。'); return false; }
    finally { setPending(''); }
  };
  const open = (videoId, time) => run('open', () => onOpenVideo(videoId, time));
  return <main className="zx-sidebar" id="zx-sidebar" data-recording={recording ? 'on' : 'off'} data-status={status}>
    {!learningClient && <header className="zx-header">
      <div className="zx-brand"><span className="zx-brand-mark" aria-hidden="true">D</span><div><strong>Delta</strong><span>YouTube 觀看助手</span></div></div>
      <span className="zx-local-badge">本機記錄</span>
    </header>}

    {learningClient && current?.videoId && <LearningWorkspace compact key={`${current?.videoId || 'no-video'}:${apiEndpoint}`} sourceVideo={learningSourceVideo(current ? { videoId: current.videoId,
      url: `https://www.youtube.com/watch?v=${current.videoId}`, title: current.title, currentTime: live?.currentTime || 0, duration: current.duration,
      watchedRanges: current.ranges || [] } : {})}
      client={learningClient} storage={learningStorage} />}
    {learningClient && <p className="zx-learning-web"><a href={`${apiEndpoint || 'https://delta-assistant-613646062582.us-central1.run.app'}/learn`} target="_blank" rel="noreferrer">喺完整網頁打開 Delta ↗</a></p>}

    <details className="zx-legacy-tools" id="ext-legacy-tools" open={learningClient && current?.videoId === LEARNING_PILOT.videoId ? undefined : true}>
      <summary>觀看紀錄與內容比較 <span>{currentCoverage.percent}% 已睇 · {formatTime(currentCoverage.watched)}</span></summary>

    <ValueAnalysis analysis={analysis} analysisBusy={analysisBusy} analysisError={analysisError} onAnalyze={onAnalyze} onCancelAnalyze={onCancelAnalyze}
      apiEndpoint={apiEndpoint} onEndpointChange={onEndpointChange} onOpenVideo={open} />

    {shownError && <section className="zx-error" id="ext-storage-error" role="alert">
      <strong>未能確認已儲存</strong><p>{shownError}</p>
      <button id="ext-retry" disabled={Boolean(pending)} onClick={() => run('retry', onRetry)}>重新讀取</button>
    </section>}

    <section className="zx-recording" aria-label="自動記錄設定">
      <label htmlFor="ext-recording-toggle"><span>自動記錄已睇片段<small>照常睇片，唔使手動輸入</small></span>
        <span className="zx-switch"><input id="ext-recording-toggle" type="checkbox" checked={recording} disabled={Boolean(pending)}
          onChange={(event) => { const next = event.target.checked; run('recording', () => onToggleRecording(next)); }} /><span aria-hidden="true" /></span>
      </label>
      {!recording && <p id="ext-recording-off" className="zx-note">記錄已關閉；現有進度保留，重新開啟後先繼續記錄。</p>}
    </section>

    <section className="zx-card zx-current" id="ext-current" aria-labelledby="ext-current-label">
      <div className="zx-eyebrow" id="ext-current-label">而家睇緊</div>
      {current ? <>
        <h1 id="ext-current-title">{current.title}</h1>
        <p className={`zx-live-status ${status === 'playing' && !shownError ? 'zx-is-playing' : ''}`} id="ext-live-status" role="status">
          <span aria-hidden="true" />{shownError ? '儲存狀態有問題，請先重試' : !recording ? '自動記錄已關閉' : statusText[status] || statusText.waiting}
          {Number.isFinite(live.currentTime) && <span className="zx-position">{formatTime(live.currentTime)}</span>}
        </p>
        <div className="zx-progress-heading"><strong>{currentCoverage.percent}<small>% 已睇</small></strong><span>{formatTime(currentCoverage.watched)}{currentCoverage.duration > 0 && `／${formatTime(currentCoverage.duration)}`}</span></div>
        <CoverageBar id="ext-video-progress" value={currentCoverage.watched} max={currentCoverage.duration} label="目前影片已看時間覆蓋" />
        {currentCoverage.duration > 0 ? <>
          <div className="zx-segment-track" aria-hidden="true">{currentCoverage.ranges.map(([start, end]) => <i key={start} style={{ left: `${start / currentCoverage.duration * 100}%`, width: `${(end - start) / currentCoverage.duration * 100}%` }} />)}</div>
          <p className="zx-note">{currentCoverage.gaps.length ? `仲有 ${formatTime(currentCoverage.duration - currentCoverage.watched)} 未睇；跳過嘅部分唔計。` : '呢條影片嘅全部時段都有播放記錄。'}</p>
        </> : <p className="zx-note">等候影片長度；已記錄嘅片段仍會保留。</p>}
        <details className="zx-ranges" id="ext-current-ranges"><summary>已睇邊段{currentCoverage.ranges.length > 0 && ` · ${currentCoverage.ranges.length} 段`}</summary>
          {currentCoverage.ranges.length ? <div className="zx-range-chips">{currentCoverage.ranges.map((range) => <button key={range[0]} onClick={() => open(current.videoId, range[0])}>{timeRange(range)}</button>)}</div> : <p className="zx-note">未有實播記錄。播放後會自動開始累積。</p>}
          {currentCoverage.gaps.length > 0 && <div className="zx-gaps"><span>未睇範圍</span>{currentCoverage.gaps.slice(0, 3).map((range) => <button key={range[0]} onClick={() => open(current.videoId, range[0])}>{timeRange(range)} <span aria-hidden="true">↗</span></button>)}{currentCoverage.gaps.length > 3 && <small>另有 {currentCoverage.gaps.length - 3} 段未睇</small>}</div>}
        </details>
      </> : <div id="ext-empty-player" className="zx-empty-player"><span aria-hidden="true">▶</span><h1>打開 YouTube，照常睇片</h1><p>播放後，自動記低實際播過嘅片段；關頁再開，進度都會保留。</p><p className="zx-note">首次安裝由而家開始記錄，唔會補回過去嘅觀看紀錄。</p></div>}
    </section>

    <section className="zx-goal" aria-labelledby="ext-goal-label">
      <div className="zx-section-heading"><h2 id="ext-goal-label">我嘅學習目標 <small>選填</small></h2>{!editingGoal && <button id="ext-goal-edit" className="zx-text-button" onClick={() => { setGoalDraft(stored.goal || ''); setEditingGoal(true); }}>{stored.goal ? '修改' : '加一個目標'}</button>}</div>
      {editingGoal ? <form id="ext-goal-form" onSubmit={async (event) => { event.preventDefault(); if (await run('goal', () => onGoalChange(goalDraft.trim()))) setEditingGoal(false); }}>
        <label className="zx-sr-only" htmlFor="ext-goal-input">學習目標</label><input autoFocus id="ext-goal-input" value={goalDraft} maxLength={160} onChange={(event) => setGoalDraft(event.target.value)} placeholder="例如：了解 AI 產品護城河" />
        <div className="zx-form-actions"><button className="zx-primary" id="ext-goal-save" disabled={Boolean(pending)}>{pending === 'goal' ? '儲存中…' : '儲存'}</button><button type="button" id="ext-goal-cancel" disabled={Boolean(pending)} onClick={() => setEditingGoal(false)}>取消</button></div>
      </form> : <p id="ext-goal-value">{stored.goal || '未設定；唔影響自動記錄。'}</p>}
    </section>

    <section className="zx-card zx-route" id="ext-route" aria-labelledby="ext-route-label">
      <div className="zx-section-heading"><h2 id="ext-route-label">固定三章觀看清單</h2><span className="zx-route-count">{route.completedSteps}／{route.totalSteps}</span></div>
      <p className="zx-note">固定建議路線 · AI 產品護城河<br />按已睇範圍繼續，未按目標生成。</p>
      <div className="zx-route-progress"><CoverageBar id="ext-route-progress" value={route.watchedSeconds} max={route.totalSeconds} label="三個建議章節已看時間覆蓋" /><strong>{route.percent}%</strong></div>
      <p className="zx-route-time">已睇 {formatTime(route.watchedSeconds)}／{formatTime(route.totalSeconds)} · {route.complete ? '章節已全部播過' : `仲差 ${formatTime(route.remainingSeconds)}`}</p>
      {route.next ? <button className="zx-next" id="ext-route-next" onClick={() => open(episodes.find((item) => item.id === route.next.episodeId).videoId, route.next.time)}><span>繼續第一段未睇嘅章節<strong>{route.next.title}</strong><small>由 {formatTime(route.next.time)} 開始</small></span><span aria-hidden="true">↗</span></button> : <p id="ext-route-complete" className="zx-complete">✓ 三個建議章節已全部播過，可以重溫。</p>}
      <ol className="zx-steps">{route.steps.map((step, index) => <li key={step.episodeId} id={`ext-step-${step.episodeId}`} data-status={step.status} aria-current={step.isNext ? 'step' : undefined}><span className="zx-step-marker" aria-hidden="true">{step.status === 'done' ? '✓' : index + 1}</span><div><button onClick={() => open(episodes.find((item) => item.id === step.episodeId).videoId, step.gaps[0]?.[0] ?? step.start)}>{step.title}</button><p>{step.status === 'done' ? '已播過全部章節' : `${step.status === 'partial' ? '部分已睇' : '未睇'} · 仲差 ${formatTime(step.remainingSeconds)}`}</p><small>{formatTime(step.start)}–{formatTime(step.end)}</small></div></li>)}</ol>
    </section>

    <section className="zx-history" id="ext-history" aria-labelledby="ext-history-label"><div className="zx-section-heading"><h2 id="ext-history-label">我已睇過乜</h2><span className="zx-history-count">{history.length} 條</span></div>
      {history.length ? <ol>{history.map((video) => { const info = coverage(video); return <li key={video.videoId} id={`ext-history-${video.videoId}`}><button className="zx-history-title" onClick={() => open(video.videoId, info.ranges[0]?.[0] || 0)}>{video.title || 'YouTube 影片'} <span aria-hidden="true">↗</span></button><p>已睇 {formatTime(info.watched)}{info.duration > 0 && ` · ${info.percent}%`}</p><details><summary>查看 {info.ranges.length} 段已睇範圍</summary><div className="zx-range-chips">{info.ranges.map((range) => <button key={range[0]} onClick={() => open(video.videoId, range[0])}>{timeRange(range)}</button>)}</div></details></li>; })}</ol> : <p id="ext-history-empty" className="zx-empty-history">未有記錄。唔使匯入或填表，直接喺 YouTube 開始睇就得。</p>}
    </section>
    <footer className="zx-footer"><p>觀看紀錄同分析結果儲存喺呢個 Chrome，未有跨裝置同步。</p><p>進度表示播放範圍，唔代表已學識。按「分析」先傳送指定範圍。</p></footer>
    </details>
  </main>;
}
