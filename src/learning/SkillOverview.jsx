import React, { useState } from 'react';
import { ArrowRightIcon, CheckCircledIcon, ChevronRightIcon, ExternalLinkIcon, MixerHorizontalIcon, ReaderIcon, RowsIcon } from '@radix-ui/react-icons';
import './skill-tree.css';

const REGION_SKILL = 'sumif-text-equality';
const SKILLS = [
  { id: 'excel-column-total', label: 'Total a column of numbers', method: 'SUM', description: 'Add all the values in a column.', inputId: 'skill-familiar-total' },
  { id: REGION_SKILL, label: 'Total revenue for one specified region', method: 'SUMIF', description: 'Choose a region, then total its matching rows.', inputId: 'skill-familiar-region' },
];
const PILOT_URL = 'https://www.youtube.com/watch?v=dI8w0utjUc0&t=35s';

const VALUE_COPY = {
  new: { label: 'Potential new step', title: 'Add a condition to your totals.', description: 'This excerpt could help you total revenue for one specified region, instead of adding every row.', action: 'Learn this step' },
  consolidation: { label: 'Useful practice', title: 'Put a familiar idea into practice.', description: 'You told Delta this ability is familiar. Try a fresh dataset to build evidence for a specific task.', action: 'Practise this step' },
  review: { label: 'Mainly review for you', title: 'Build on your checked practice.', description: 'You already have practice evidence for this type of task. This excerpt may add little new material; revisit the explanation or try another dataset.', action: 'Revisit & practise' },
  unsupported: { label: 'Video value unknown', title: 'This video is not mapped yet.', description: 'Delta needs reviewed source evidence to place a video on your path. Your saved background and practice records are kept.', action: 'Learning unavailable for this video' },
};

export function SkillOverview({ record, value, source, hydrated = false, busy = false, onLearn, onFamiliarity, onClear, onChooseSource, storageLabel = 'this browser' }) {
  const [editing, setEditing] = useState(false);
  const [setupSkipped, setSetupSkipped] = useState(false);
  const familiarity = record?.familiarity || {};
  const activity = record?.activity || {};
  const kind = Object.hasOwn(VALUE_COPY, value?.kind) ? value.kind : 'unsupported';
  const copy = VALUE_COPY[kind];
  const supported = kind !== 'unsupported';
  const disabled = !hydrated || Boolean(busy);
  // videoValue supplies evidence scoped to this reviewed source and service.
  // A historical task from a different video cannot certify this video.
  const evidence = Array.isArray(value?.evidence) ? value.evidence : [];
  const hasRecord = Object.keys(familiarity).length > 0 || Object.keys(activity).length > 0 || Boolean(record?.evidence?.length);
  const optionalSetup = hydrated && !hasRecord && !setupSkipped;

  function statusFor(skill) {
    const checked = (record?.evidence || []).filter((item) => item.skillId === skill.id);
    const taskCount = new Set(checked.map(item => JSON.stringify([item.origin, item.lessonId, item.taskId]))).size;
    if (taskCount) return { label: 'Practice checked', detail: `${taskCount} specific ${taskCount === 1 ? 'task' : 'tasks'} · formula checked`, checked: true };
    if (activity[skill.id]) return { label: 'Learning in progress', detail: 'You started exploring this ability.', checked: false };
    return { label: 'Not started', detail: '', checked: false };
  }

  return <section id="skill-overview" className="dsk-overview" aria-label="Your Excel skill path" aria-busy={disabled}>
    <div className="dsk-intro">
      <span className="dsk-eyebrow">YOUR LEARNING PATH</span>
      <h1>Build on what you know.</h1>
      <p>The same video can offer a different next step for each learner.</p>
    </div>

    <section id="skill-value" className={`dsk-value dsk-value-${kind}`} data-value-kind={kind} aria-labelledby="skill-value-title" aria-live="polite">
      <div className="dsk-value-label"><ReaderIcon aria-hidden="true" /><span>WHAT THIS VIDEO ADDS</span></div>
      <span className="dsk-value-kind">{copy.label}</span>
      <h2 id="skill-value-title">{copy.title}</h2>
      <p>{copy.description}</p>
      {kind === 'new' && familiarity['excel-column-total'] && <p className="dsk-context">You already know basic totals. This step adds a region condition.</p>}
      {kind === 'review' && <span className="dsk-checked-note"><CheckCircledIcon aria-hidden="true" />Checked practice, for a specific task scope</span>}
      <button id="skill-learn" className="dsk-primary" type="button" onClick={onLearn} disabled={disabled || !supported}>
        {!hydrated ? 'Restoring your path…' : busy ? 'Please wait…' : copy.action}<ArrowRightIcon aria-hidden="true" />
      </button>
      {supported ? <a id="skill-source" className="dsk-source" href={PILOT_URL} target="_blank" rel="noreferrer"><span>Reviewed source · Teacher’s Tech</span><span>0:35–3:06 <ExternalLinkIcon aria-hidden="true" /></span></a>
        : <div id="skill-source" className="dsk-unsupported-source"><span>{source?.title || 'Current video'}</span><p>Only the reviewed Teacher’s Tech SUMIF excerpt is supported in this pilot.</p>{onChooseSource && <button id="skill-choose-source" type="button" className="dsk-text-button" onClick={onChooseSource} disabled={disabled}>Choose a supported source <ChevronRightIcon aria-hidden="true" /></button>}<a className="dsk-source" href={PILOT_URL} target="_blank" rel="noreferrer">Open the supported excerpt <ExternalLinkIcon aria-hidden="true" /></a></div>}
    </section>

    <section className="dsk-path-section" aria-labelledby="skill-path-title">
      <div className="dsk-section-heading"><div><span className="dsk-eyebrow">EXCEL · EVERYDAY TOTALS</span><h2 id="skill-path-title">Your path</h2></div><button id="skill-manage" type="button" className="dsk-manage" onClick={() => setEditing((open) => !open)} aria-expanded={editing} aria-controls="skill-background-editor" disabled={disabled}><MixerHorizontalIcon aria-hidden="true" />{editing ? 'Done' : 'Edit background'}</button></div>
      <ol id="skill-path" className="dsk-path">
        {SKILLS.map((skill, index) => {
          const status = statusFor(skill);
          const target = skill.id === REGION_SKILL;
          const contents = <><span className={`dsk-node-marker ${status.checked ? 'dsk-node-checked' : ''}`} aria-hidden="true">{status.checked ? <CheckCircledIcon /> : index + 1}</span><span className="dsk-node-content"><span className="dsk-node-topline"><span className="dsk-method">{skill.method}</span>{target && supported && <span className="dsk-video-tag">This video</span>}</span><strong>{skill.label}</strong><span className="dsk-node-description">{skill.description}</span><span className={`dsk-status ${status.checked ? 'dsk-status-checked' : ''}`}>{status.label}</span>{status.detail && <span className="dsk-status-detail">{status.detail}</span>}{familiarity[skill.id] && <span className="dsk-familiar"><CheckCircledIcon aria-hidden="true" />Familiar · you told Delta</span>}</span>{target && supported && <ChevronRightIcon className="dsk-node-arrow" aria-hidden="true" />}</>;
          return <li key={skill.id} data-skill-id={skill.id} className={target && supported ? 'dsk-node dsk-node-current' : 'dsk-node'}>{target && supported ? <button type="button" className="dsk-node-button" onClick={onLearn} disabled={disabled} aria-label={`Learn: ${skill.label}`}>{contents}</button> : <div className="dsk-node-static">{contents}</div>}</li>;
        })}
      </ol>
      <p className="dsk-path-note">Related abilities. You can try regional totals directly.</p>
    </section>

    {optionalSetup && !editing && <aside className="dsk-setup"><RowsIcon aria-hidden="true" /><div><strong>Your starting point is optional.</strong><p>Use “Edit background” to tell Delta what feels familiar, or start learning directly.</p><button id="skill-skip-setup" type="button" className="dsk-text-button" onClick={() => setSetupSkipped(true)}>Skip for now <ChevronRightIcon aria-hidden="true" /></button></div></aside>}

    {editing && <section id="skill-background-editor" className="dsk-editor" aria-labelledby="skill-background-title"><div className="dsk-editor-heading"><h2 id="skill-background-title">What already feels familiar?</h2><p>These are your own statements, separate from checked practice. You can change them at any time.</p></div><div className="dsk-familiar-options">{SKILLS.map((skill) => <label key={skill.id} className="dsk-familiar-choice" htmlFor={skill.inputId}><input id={skill.inputId} type="checkbox" checked={Boolean(familiarity[skill.id])} disabled={disabled} onChange={(event) => onFamiliarity?.(skill.id, event.target.checked)} /><span><strong>{skill.label}</strong><small>{skill.method} · Familiar · you told Delta</small></span></label>)}</div>{optionalSetup && <button id="skill-skip-setup" type="button" className="dsk-text-button" onClick={() => { setEditing(false); setSetupSkipped(true); }}>Skip for now</button>}<div className="dsk-clear"><button id="skill-clear-record" type="button" className="dsk-text-button" onClick={onClear} disabled={disabled || !hasRecord}>Clear local skill record</button><p>Clears only this skill record. Your lesson, answer draft and watching records stay.</p></div></section>}

    <footer className="dsk-record-note"><span className="dsk-local-dot" aria-hidden="true" /><p>Saved locally in {storageLabel}. Website and extension records do not sync through an account.</p></footer>
  </section>;
}

export default SkillOverview;
