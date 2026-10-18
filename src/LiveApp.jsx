import React, { useEffect, useRef, useState } from 'react';
import ValueAnalysis from '../extension/ValueAnalysis.jsx';
import { fetchAnalysis } from '../extension/analysis-client.js';
import { serviceStatusText } from './service-status.js';
import './live.css';

const materials = [
  { name: 'Cursor', topic: '產品嘅競爭優勢', videoId: 'En5cSXgGvZM', start: 2325, range: '38:45–46:16' },
  { name: 'YC Lightcone', topic: 'AI 新創護城河', videoId: 'bxBzsSsqQAM', start: 1170, range: '19:30–31:24' },
  { name: 'Anthropic', topic: 'AI 創業機會', videoId: 'DKrBGOFs0GY', start: 2836, range: '47:16–52:03' },
];

export default function LiveApp() {
  const [health, setHealth] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [goal, setGoal] = useState('');
  const request = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error('unavailable');
      return response.json();
    }).then(setHealth).catch(() => { if (!controller.signal.aborted) setHealth({ ok: false }); });
    return () => { controller.abort(); request.current?.abort(); };
  }, []);
  async function analyze() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setAnalysis(null);
    try {
      // A public browser page cannot access private extension storage. Never seed history.
      const result = await fetchAnalysis(location.origin, { schemaVersion: 1, goal: goal.trim(), watched: [] }, { signal: controller.signal });
      setAnalysis(result);
    } catch (failure) {
      if (request.current === controller) setError(failure.name === 'AbortError' ? '分析已停止或逾時，觀看紀錄不受影響。' : failure.message);
    } finally {
      if (request.current === controller) setBusy(false);
    }
  }
  const configured = health?.analysis?.configured === true;
  const serviceStatus = serviceStatusText(health);
  return <div className="live-app">
    <header className="live-header"><a className="live-brand" href="/">Delta<span>YOUTUBE 學習助手</span></a><a href="/prototype">睇互動示意 →</a></header>
    <main className="live-layout">
      <div className="live-story">
        <p className="live-eyebrow">接住你睇過嘅，揀下一段。</p>
        <h1>呢條片，<br />仲有乜值得我睇？</h1>
        <p className="live-lead">記低真正睇過嘅片段，比較新舊論點，再解釋下一段點解值得睇。</p>
        <ol className="live-steps"><li><span>01</span><div><strong>我已經睇過乜</strong><p>Chrome extension 自動記錄實播範圍；跳過嘅部分保持空白，重開保留。</p></div></li><li><span>02</span><div><strong>今段增加咗乜</strong><p>分清重複論點、新例子、新觀點同反方，附新舊來源時間碼。</p></div></li><li><span>03</span><div><strong>下一段點解值得睇</strong><p>只推一段，講清理由，直接開原片核對。</p></div></li></ol>
        <section className="live-materials" aria-labelledby="materials-title"><h2 id="materials-title">先由呢三集測試</h2><p>目前只用三集入面 4 段經獨立 AI 來源核對嘅片段，共 4:48。下列係候選章節，唔代表整章已分析；內容及時間碼仍未經人手逐項核對。</p>{materials.map((item) => <a key={item.videoId} href={`https://www.youtube.com/watch?v=${item.videoId}&t=${item.start}s`} target="_blank" rel="noreferrer"><span><strong>{item.name}</strong><small>{item.topic}</small></span><span>{item.range} ↗</span></a>)}</section>
      </div>
      <aside className="live-assistant" aria-label="試用 Delta">
        <div className="live-status"><span className={configured ? 'is-live' : ''} />{serviceStatus}</div>
        <div className="live-first-use"><h2>第一次用？先揀個起點。</h2><p>呢個公開頁面讀唔到你 Chrome 嘅觀看紀錄，所以只會提供一般入門推薦。個人比較請用 extension 側欄。</p><label htmlFor="live-goal">今次想了解乜？<small>選填</small></label><input id="live-goal" maxLength={200} value={goal} placeholder="例如：AI 產品點建立護城河" disabled={busy} onChange={(event) => { setGoal(event.target.value); setAnalysis(null); }} /></div>
        <ValueAnalysis analysis={analysis} analysisBusy={busy} analysisError={error} onAnalyze={analyze} onCancelAnalyze={() => request.current?.abort()} showEndpoint={false} />
        <section className="live-install"><h2>喺真正 YouTube 用</h2><p>新安裝用 Downloads／Delta-Chrome-MVP；已安裝嘅用戶沿用 Downloads／Zhixin-Chrome-MVP 重新載入，再喺原生側欄設定分析服務網址為呢個網站網址。</p><p>分析由你按掣開始；只傳三集嘅指定觀看範圍同選填目標。其他影片記錄保留本機。</p><p className="live-limits">AI 整理及時間碼仍需核對；已看唔代表已理解。未設定分析服務時會顯示未能分析，唔會套入示例答案。</p></section>
      </aside>
    </main>
    <footer className="live-footer">Delta MVP 0.3.2 · 真實觀看紀錄 × 有來源嘅下一段建議</footer>
  </div>;
}
