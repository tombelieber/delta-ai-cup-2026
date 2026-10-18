import React, { useRef, useState } from 'react';
import { shouldSuggestLearning } from './contextual-learning.js';

function LearningNudge({ view, onLearn, onDismiss }) {
  const [pending, setPending] = useState('');
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  async function act(action) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(action);
    setError('');
    try {
      // Invoke the callback in this click's synchronous turn so Chrome can
      // carry the user gesture through the runtime message to sidePanel.open.
      const result = await (action === 'learn' ? onLearn?.() : onDismiss?.());
      if (result?.ok !== true) throw new Error('Action was not confirmed');
      setHidden(true);
    } catch {
      setError(action === 'learn'
        ? 'Could not open Delta. Click Delta in the Chrome toolbar to open the side panel, then try again.'
        : 'Could not save your choice. Please try Not now again.');
    } finally {
      inFlight.current = false;
      setPending('');
    }
  }

  if (hidden || !shouldSuggestLearning(view)) return null;
  return <aside className="zx-learning-nudge" id="zx-page-view" lang="en"
    data-video-id={view.videoId} aria-labelledby="zx-nudge-title">
    <span className="zx-nudge-eyebrow">A LITTLE HELP FROM DELTA</span>
    <h2 id="zx-nudge-title">Learn this skill more easily.</h2>
    <p>Get a short lesson and practice. Keep this video and your progress together.</p>
    <div className="zx-nudge-actions">
      <button type="button" className="zx-nudge-learn" disabled={Boolean(pending)} onClick={() => act('learn')}>
        {pending === 'learn' ? 'Opening Delta…' : 'Learn with Delta →'}
      </button>
      <button type="button" className="zx-nudge-dismiss" disabled={Boolean(pending)} onClick={() => act('dismiss')}>
        {pending === 'dismiss' ? 'Saving…' : 'Not now'}
      </button>
    </div>
    <details className="zx-nudge-why">
      <summary>Why this suggestion?</summary>
      <p>Delta has a reviewed SUMIF lesson and practice for this video, to help you total revenue for one region. No profile form is needed.</p>
    </details>
    <p className="zx-nudge-error" role="status">{error}</p>
  </aside>;
}

// A keyed child resets action state when YouTube navigates to another video.
// The recorder remains independent; this component reads no page or storage APIs.
export default function InPageProgress({ view = {}, onLearn, onDismiss }) {
  return <LearningNudge key={view.videoId || ''} view={view} onLearn={onLearn} onDismiss={onDismiss} />;
}
