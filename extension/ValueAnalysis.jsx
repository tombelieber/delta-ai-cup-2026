import React, { useEffect, useState } from 'react';
import { formatTime } from '../src/assistant-data.js';
import './value-analysis.css';

const relationLabels = {
  repeated: '重複主張', new_example: '新例子', new_idea: '新觀點',
  opposing: '反方觀點', unknown: '未能判斷',
};
const episodeNames = { En5cSXgGvZM: 'Cursor', bxBzsSsqQAM: 'YC Lightcone', DKrBGOFs0GY: 'Anthropic' };

// The server validates evidence bounds. Links are independently rebuilt from a
// video ID and finite timestamp rather than trusting a model-authored URL.
function sourceLink(source) {
  if (!source || !/^[A-Za-z0-9_-]{11}$/.test(source.videoId) ||
    !Number.isFinite(source.start) || !Number.isFinite(source.end) || source.start < 0 || source.end <= source.start) return null;
  return `https://www.youtube.com/watch?v=${source.videoId}&t=${Math.floor(source.start)}s`;
}
function EvidenceLink({ source, onOpenVideo, children, className = '' }) {
  const href = sourceLink(source);
  if (!href) return <span className="zx-value-source-missing">來源時間未能確認</span>;
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer"
    onClick={onOpenVideo ? (event) => { event.preventDefault(); onOpenVideo(source.videoId, source.start); } : undefined}>
    {children || `${episodeNames[source.videoId] || 'YouTube'} · ${formatTime(source.start)}–${formatTime(source.end)}`}<span aria-hidden="true"> ↗</span>
  </a>;
}
function MemoryPoint({ item, onOpenVideo }) {
  return <li><p>{item.summary}</p>
    {item.conditions?.length > 0 && <p className="zx-value-conditions">適用條件：{item.conditions.join('；')}</p>}
    <EvidenceLink source={item.source} onOpenVideo={onOpenVideo} className="zx-value-source" />
  </li>;
}

export function ValueAnalysis({ analysis = null, analysisBusy = false, analysisError = '',
  onAnalyze = () => {}, onCancelAnalyze = null, apiEndpoint = '', onEndpointChange = null, onOpenVideo = null, showEndpoint = true }) {
  const [endpointDraft, setEndpointDraft] = useState(apiEndpoint);
  const [endpointBusy, setEndpointBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  useEffect(() => setEndpointDraft(apiEndpoint), [apiEndpoint]);
  const memory = Array.isArray(analysis?.memory) ? analysis.memory : [];
  const recommendation = analysis?.recommendation;
  const limitations = Array.isArray(analysis?.limitations) ? analysis.limitations : [];
  const coldStart = analysis?.status === 'no_history';
  const insufficient = analysis?.status === 'insufficient_source';
  const unavailable = analysis?.status === 'unavailable';
  const stale = Boolean(analysis?.stale);
  const error = analysisError || localError;
  const analyze = async () => {
    setLocalError('');
    try { await onAnalyze(); } catch { setLocalError('分析未能完成。觀看記錄仍然保留，可以再試。'); }
  };
  return <section className="zx-value" id="ext-value-analysis" aria-labelledby="ext-value-heading"
    data-analysis-status={analysisBusy ? 'loading' : analysis?.status || 'idle'} data-analysis-stale={stale ? 'true' : 'false'}>
    <header className="zx-value-heading"><span className="zx-value-kicker">由已睇，揀下一段</span><h2 id="ext-value-heading">下一段應該睇乜？</h2>
      <p>對照你實際播過嘅內容，睇清楚下一段補到乜。</p></header>

    {error && <p className="zx-value-alert" id="ext-analysis-error" role="alert">{error}{analysis && ' 以下保留上次結果。'}</p>}
    {analysisBusy && <p className="zx-value-notice" id="ext-analysis-loading" role="status">正在讀取章節內容，再比較已睇範圍…<br />首次分析可能需要幾分鐘。唔會將跳過嘅部分當成已睇。</p>}
    {stale && <p className="zx-value-alert" id="ext-analysis-stale" role="status">觀看範圍、目標或服務已改變。以下係上次結果，請更新分析。</p>}

    {!analysis && !analysisBusy && <div className="zx-value-intro" id="ext-analysis-intro">
      <ol><li><span>1</span>你已睇過嘅重點</li><li><span>2</span>下一段新增嘅價值</li><li><span>3</span>值得繼續睇嘅理由</li></ol>
      <p>首次用，未有記錄？會先提供一般入門建議。</p>
    </div>}

    {analysis && <div className="zx-value-result" id="ext-analysis-result">
      {coldStart && <p className="zx-value-notice" id="ext-analysis-cold-start">一般入門建議 · 未有可比較嘅已看內容，暫時唔判斷對你有幾新。</p>}
      {insufficient && <p className="zx-value-notice" id="ext-analysis-insufficient">已看內容或來源不足，未能完整比較新增價值。</p>}
      {unavailable && <p className="zx-value-alert" id="ext-analysis-unavailable">內容分析暫時未可用。觀看記錄同進度會照常保留。</p>}

      <section className="zx-value-memory" aria-labelledby="ext-memory-label"><h3 id="ext-memory-label"><span>1</span>你已睇過嘅重點 <small>{memory.length} 項</small></h3>
        {memory.length ? <><ol id="ext-memory-points">{memory.slice(0, 3).map((item, index) => <MemoryPoint key={item.id || index} item={item} onOpenVideo={onOpenVideo} />)}</ol>
          {memory.length > 3 && <details className="zx-value-more" id="ext-memory-more"><summary>其餘已看論點（{memory.length - 3}）</summary><ol>{memory.slice(3).map((item, index) => <MemoryPoint key={item.id || index} item={item} onOpenVideo={onOpenVideo} />)}</ol></details>}
        </> : <p className="zx-value-muted" id="ext-memory-empty">{unavailable ? '未能取得有來源嘅內容分析。' : '未有足夠已看片段形成內容記憶。'} 播過唔代表已學識。</p>}
      </section>

      {recommendation ? <section className="zx-value-candidate" id="ext-analysis-recommendation" aria-labelledby="ext-recommendation-title">
        <h3><span>2</span>{coldStart ? '建議先睇' : '下一段補到乜'}</h3>
        <div className="zx-value-relation" data-relation={recommendation.relation || 'unknown'} id="ext-recommendation-relation">{relationLabels[recommendation.relation] || relationLabels.unknown}</div>
        <h4 id="ext-recommendation-title">{recommendation.title}</h4>
        <p>{recommendation.summary}</p>
        <div className="zx-value-adds"><strong>{coldStart ? '入門方向' : '新增價值'}</strong><p id="ext-recommendation-adds">{recommendation.adds}</p></div>
        {recommendation.comparedTo?.length > 0 && <details className="zx-value-comparison" id="ext-comparison-basis"><summary>對照邊段已看內容？</summary><ul>{recommendation.comparedTo.map((item, index) => <li key={item.memoryId || index}><EvidenceLink source={item.source} onOpenVideo={onOpenVideo} /></li>)}</ul></details>}
        <div className="zx-value-reason"><h3><span>3</span>點解而家值得睇</h3><p id="ext-recommendation-reason">{recommendation.reason}</p>
          {recommendation.usefulness === 'limited' && <small>與目前目標嘅關聯有限。</small>}
          {recommendation.usefulness === 'unknown' && <small>用途仍待你睇完判斷。</small>}
        </div>
        <EvidenceLink source={recommendation.candidateSource} onOpenVideo={onOpenVideo} className="zx-value-watch" >
          {sourceLink(recommendation.candidateSource) ? `由 ${formatTime(recommendation.candidateSource.start)} 睇${coldStart ? '入門章節' : '下一段'}` : '來源時間未能確認'}
        </EvidenceLink>
        <p className="zx-value-time">{sourceLink(recommendation.candidateSource) && `${episodeNames[recommendation.candidateSource.videoId] || 'YouTube'} · ${formatTime(recommendation.candidateSource.start)}–${formatTime(recommendation.candidateSource.end)}`}</p>
      </section> : !unavailable && <p className="zx-value-muted" id="ext-recommendation-empty">暫時冇足夠來源推薦下一段；唔會用固定路線充當分析結果。</p>}

      {limitations.length > 0 && <details className="zx-value-limitations" id="ext-analysis-limitations" open={unavailable || insufficient}><summary>分析限制與來源狀態</summary><ul>{limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      {!unavailable && analysis.source?.verification === 'ai_derived_not_human_verified' && <p className="zx-value-disclosure" id="ext-analysis-verification">AI 根據影片內容整理，未經人手逐項核對；可按時間連結查原片。</p>}
    </div>}

    <div className="zx-value-action"><button type="button" className="zx-value-analyze" id="ext-analyze" disabled={analysisBusy || endpointBusy} onClick={analyze}>
      {analysisBusy ? '分析中…' : analysis ? '更新內容分析' : '分析已睇，揀下一段'}
    </button>{analysisBusy && onCancelAnalyze && <button type="button" className="zx-value-cancel" id="ext-analysis-cancel" onClick={onCancelAnalyze}>取消今次分析</button>}<p id="ext-analysis-consent">按下先會傳送指定三集嘅候選章節已看範圍同選填目標到分析服務。其他影片標題同觀看紀錄唔會傳送。</p></div>

    {showEndpoint && onEndpointChange && <details className="zx-value-settings" id="ext-analysis-settings"><summary>分析服務設定</summary>
      <form onSubmit={async (event) => { event.preventDefault(); setEndpointBusy(true); setLocalError(''); try { await onEndpointChange(endpointDraft.trim()); } catch (failure) { setLocalError(failure?.message || '服務設定未能儲存，請檢查網址。'); } finally { setEndpointBusy(false); } }}>
        <label htmlFor="ext-analysis-endpoint">服務網址</label><input id="ext-analysis-endpoint" type="url" value={endpointDraft} required spellCheck={false} onChange={(event) => setEndpointDraft(event.target.value)} placeholder="https://your-service.example" />
        <p>只接受 HTTPS 或本機服務；首次連接可能需要批准呢個網址。API key 只設喺伺服器。</p>
        <button id="ext-analysis-endpoint-save" disabled={endpointBusy || analysisBusy}>{endpointBusy ? '儲存中…' : '儲存服務網址'}</button>
      </form>
    </details>}
  </section>;
}

export default ValueAnalysis;
