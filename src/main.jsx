import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
const App = lazy(() => import('./App.jsx'));
const LiveApp = lazy(() => import('./LiveApp.jsx'));
const LiveLearningApp = lazy(() => import('./learning/LiveLearningApp.jsx'));

createRoot(document.getElementById('root')).render(<Suspense fallback={<p role="status">Loading Delta…</p>}>
  {['/prototype', '/prototype/'].includes(location.pathname) ? <App /> : ['/assistant', '/assistant/'].includes(location.pathname) ? <LiveApp /> : <LiveLearningApp />}
</Suspense>);
