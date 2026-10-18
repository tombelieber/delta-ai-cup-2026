import { validVideoId } from './store.js';
import { isolateEditableKeyboard } from './editable-keyboard.js';

export const IN_PAGE_HOST_ID = 'zhixin-inpage-host';

// This adapter owns only its own node. YouTube can move/replace the right column;
// the recorder's normal ticks reattach one host without replacing site markup.
export function createInPageHost({ document: doc, getVideoId, css, render, unmount = () => {}, shouldShow = () => true }) {
  let host = null, container = null, view = null, destroyed = false, releaseKeyboard = null;
  const activeId = () => { const id = getVideoId(); return validVideoId(id) ? id : null; };
  // YouTube keeps #secondary in the DOM with display:none on narrow layouts.
  // A present-but-hidden anchor would leave a working card invisible forever.
  const anchor = () => ['#secondary-inner', '#secondary', 'ytd-watch-flexy #below']
    .map((selector) => doc.querySelector(selector))
    .find((element) => element && element.getBoundingClientRect().width > 0);
  function detach() { host?.remove(); }
  function paint() {
    if (destroyed) return;
    const id = activeId();
    if (!id || view?.videoId !== id || !shouldShow(view)) { detach(); return; }
    const parent = anchor();
    if (!parent) { detach(); return; }
    if (!host) {
      // A previous complete runtime is disposed by content-entry before mount.
      // Remove only a stale host owned by this extension, never YouTube nodes.
      doc.getElementById(IN_PAGE_HOST_ID)?.remove();
      host = doc.createElement('section'); host.id = IN_PAGE_HOST_ID;
      host.setAttribute('aria-label', 'Delta learning suggestion');
      const shadow = host.attachShadow({ mode: 'open' });
      releaseKeyboard = isolateEditableKeyboard(shadow);
      const style = doc.createElement('style'); style.textContent = css;
      container = doc.createElement('div');
      shadow.append(style, container);
    }
    if (host.parentNode !== parent || !host.isConnected) parent.prepend(host);
    render(container, view);
  }
  function setContext(live) {
    if (destroyed) return;
    const id = activeId();
    if (!id) { view = null; detach(); return; }
    if (view?.videoId !== id) view = { videoId: id, title: live?.title || 'YouTube video', duration: live?.duration || 0,
      ranges: [], recordingEnabled: true, status: 'waiting', currentTime: 0, updatedAt: 0, error: '', loading: true, route: null };
    if (live?.videoId === id) {
      view = { ...view, title: live.title || view.title, currentTime: live.currentTime, status: live.status };
      if (Number.isFinite(live.duration) && live.duration > 0 && !['ad', 'unavailable'].includes(live.status)) view.duration = live.duration;
    }
    paint();
  }
  function setView(next) {
    if (destroyed || !next || next.videoId !== activeId()) return; // Discard late ACKs from a previous video.
    view = next;
    paint();
  }
  function setError(error, videoId) {
    if (destroyed || videoId !== activeId() || view?.videoId !== videoId) return;
    view = { ...view, error };
    paint();
  }
  return { setContext, setView, setError, destroy() { if (destroyed) return; destroyed = true; detach(); releaseKeyboard?.(); releaseKeyboard = null; unmount(); host = null; container = null; view = null; } };
}
