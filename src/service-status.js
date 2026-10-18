export function serviceStatusText(health) {
  if (health === null) return '正在連接服務';
  if (health?.ok !== true) return '服務暫時未能連接';
  if (health.analysis?.reason === 'provider_billing_required') return 'Gemini 暫停 · 專案／額度待核對';
  if (health.analysis?.reason === 'source_review_required') return '本機 Gemma 暫停 · 來源品質待核對';
  if (health.analysis?.configured !== true) return 'AI 尚未設定 · 可先睇操作示意';
  const method = { local_gemma_transcript: '本機 Gemma 字幕分析', gemini_youtube_video: 'Gemini 影片分析' }[health.analysis.method] || 'AI 內容分析';
  const model = typeof health.analysis.model === 'string' ? health.analysis.model.slice(0, 80) : '';
  return `${method}已設定${model ? ` · ${model}` : ''}`;
}
