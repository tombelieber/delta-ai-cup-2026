import React from 'react';
import { LEARNING_PILOT } from './learning-source.js';

export default function LearningPilotNote({ videoId }) {
  if (videoId === LEARNING_PILOT.videoId) return null;
  return <aside className="zx-learning-pilot" id="ext-learning-pilot" role="note">
    <strong>Delta · SUMIF 教學試用版</strong>
    <p>目前課堂只支援已核對嘅 SUMIF 教學片段（0:35–3:06）。其他影片照常記錄觀看進度，暫未提供課堂生成。</p>
    <a href={LEARNING_PILOT.url} target="_blank" rel="noreferrer">打開支援嘅教學片段 ↗</a>
  </aside>;
}
