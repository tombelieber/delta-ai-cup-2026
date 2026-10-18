import { createYouTubeRecorder } from './content.js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import InPageProgress from './InPageProgress.jsx';
import pageCss from './in-page.css?inline';
import { createInPageHost } from './in-page-host.js';
import { youtubeVideoId } from './store.js';
import { shouldSuggestLearning } from './contextual-learning.js';
import { installAccountHistoryPage } from './account-history-page.js';
import { installYouTubeTranscript } from './youtube-transcript.js';

const runtimeKey = '__zhixinInPageRuntimeV2';
globalThis[runtimeKey]?.stop();
let root;
const page = createInPageHost({ document, getVideoId: () => youtubeVideoId(location.href), css: pageCss, shouldShow: shouldSuggestLearning,
  render(container, view) {
    root ||= createRoot(container);
    root.render(React.createElement(InPageProgress, {
      view,
      onLearn: () => chrome.runtime.sendMessage({ type: 'OPEN_LEARNING_PANEL', videoId: view.videoId }),
      onDismiss: () => chrome.runtime.sendMessage({ type: 'DISMISS_LEARNING_NUDGE', videoId: view.videoId }),
    }));
  },
  unmount() { root?.unmount(); root = null; },
});
const recorder = createYouTubeRecorder({ document, window, runtime: chrome.runtime,
  onContext: page.setContext, onView: page.setView, onError: page.setError,
});
const accountHistory = installAccountHistoryPage({ document, window, runtime: chrome.runtime });
const transcript = installYouTubeTranscript({ document, window, runtime: chrome.runtime });
globalThis[runtimeKey] = { stop() { transcript.stop(); accountHistory.stop(); recorder.stop(); page.destroy(); } };
