import test from 'node:test';
import assert from 'node:assert/strict';
import { createInPageHost, IN_PAGE_HOST_ID } from './in-page-host.js';

const A = 'En5cSXgGvZM', B = 'bxBzsSsqQAM';
function harness() {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.parentNode = null; this.attributes = {}; this.connected = false; this.visible = true; this.width = 420; this.height = 100; this.listeners = new Map(); }
    get isConnected() { return this.connected || Boolean(this.parentNode?.isConnected); }
    getBoundingClientRect() { return { width: this.visible ? this.width : 0, height: this.visible ? this.height : 0 }; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(type, listener) { const handlers = this.listeners.get(type) || new Set(); handlers.add(listener); this.listeners.set(type, handlers); }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    attachShadow() { return this.shadowRoot = new Element('shadow'); }
    append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parentNode = this; } }
    prepend(node) { node.remove(); this.children.unshift(node); node.parentNode = this; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this); this.parentNode = null; }
  }
  let id = A, parent = new Element('aside'), secondary = null, below = null, unmounted = 0;
  parent.connected = true;
  const nodes = [], renders = [];
  const doc = {
    querySelector: (selector) => selector === '#secondary-inner' ? parent : selector === '#secondary' ? secondary : selector === 'ytd-watch-flexy #below' ? below : null,
    getElementById: (target) => nodes.find((node) => node.id === target && node.isConnected),
    createElement(tag) { const node = new Element(tag); nodes.push(node); return node; },
  };
  const host = createInPageHost({ document: doc, getVideoId: () => id, css: '.test{}',
    render(container, view) { renders.push({ container, view: structuredClone(view) }); }, unmount() { unmounted++; } });
  const live = (videoId = id) => ({ videoId, title: 'Actual video', duration: 600, currentTime: 450, status: 'paused' });
  const saved = (videoId = id) => ({ ...live(videoId), ranges: [[10, 20], [80, 90]], recordingEnabled: true, updatedAt: 123, error: '', loading: false });
  return { host, nodes, renders, live, saved, get parent() { return parent; }, get below() { return below; }, setId(value) { id = value; },
    addFallback() { below = new Element('below'); below.connected = true; },
    showRightColumn(visible) {
      secondary ||= new Element('secondary'); secondary.connected = true;
      parent.visible = visible; secondary.visible = visible;
    },
    replaceParent() { parent.connected = false; parent = new Element('aside'); parent.connected = true; },
    removeParent() { parent.connected = false; parent = null; }, get unmounted() { return unmounted; } };
}

test('initial playhead shows loading with no invented watched coverage', () => {
  const h = harness(); h.host.setContext(h.live());
  assert.equal(h.parent.children[0].id, IN_PAGE_HOST_ID);
  assert.equal(h.renders.at(-1).view.loading, true);
  assert.deepEqual(h.renders.at(-1).view.ranges, []);
  assert.equal(h.renders.at(-1).view.currentTime, 450);
  h.host.setView(h.saved());
  assert.equal(h.renders.at(-1).view.loading, false);
  assert.deepEqual(h.renders.at(-1).view.ranges, [[10, 20], [80, 90]]);
});

test('live ticks change position but keep last acknowledged ranges and errors', () => {
  const h = harness(); h.host.setView(h.saved());
  h.host.setError('storage unavailable', A);
  h.host.setContext({ ...h.live(), currentTime: 460, status: 'playing' });
  assert.deepEqual(h.renders.at(-1).view.ranges, [[10, 20], [80, 90]]);
  assert.equal(h.renders.at(-1).view.updatedAt, 123);
  assert.equal(h.renders.at(-1).view.error, 'storage unavailable');
  h.host.setView(h.saved());
  assert.equal(h.renders.at(-1).view.error, '');
});

test('late acknowledgements and errors from the previous video cannot replace current progress', () => {
  const h = harness(); h.host.setView(h.saved(A)); h.setId(B); h.host.setContext(h.live(B));
  const count = h.renders.length;
  h.host.setView(h.saved(A)); h.host.setError('old error', A);
  assert.equal(h.renders.length, count);
  assert.equal(h.renders.at(-1).view.videoId, B);
  assert.deepEqual(h.renders.at(-1).view.ranges, []);
  h.host.setView(h.saved(B));
  assert.equal(h.renders.at(-1).view.videoId, B);
});

test('leaving the watch page removes its host and old replies cannot remount it', () => {
  const h = harness(); h.host.setView(h.saved()); h.setId(null); h.host.setContext({ videoId: null });
  assert.equal(h.parent.children.length, 0);
  h.host.setView(h.saved(A));
  assert.equal(h.parent.children.length, 0);
});

test('YouTube replacing its right column reattaches one host and preserves its render container', () => {
  const h = harness(); h.host.setView(h.saved());
  const first = h.parent.children[0], container = h.renders.at(-1).container;
  h.replaceParent(); h.host.setContext(h.live()); h.host.setContext(h.live());
  assert.deepEqual(h.parent.children, [first]);
  assert.equal(h.renders.at(-1).container, container);
  assert.equal(h.nodes.filter((node) => node.id === IN_PAGE_HOST_ID).length, 1);
});

test('a hidden right column falls back to the visible content area instead of mounting invisibly', () => {
  const h = harness(); h.addFallback(); h.showRightColumn(false);
  h.host.setView(h.saved());
  assert.equal(h.parent.getBoundingClientRect().width, 0);
  assert.equal(h.parent.children.length, 0);
  assert.equal(h.below.children[0].id, IN_PAGE_HOST_ID);
  assert.deepEqual(h.renders.at(-1).view.ranges, [[10, 20], [80, 90]]);

  // An empty right-column box can retain height but remain unusable at zero width.
  h.parent.visible = true; h.parent.width = 0;
  h.host.setContext(h.live());
  assert.equal(h.parent.getBoundingClientRect().height, 100);
  assert.equal(h.parent.children.length, 0);
  assert.equal(h.below.children.length, 1);
});

test('viewport changes relocate one existing host between the right column and fallback without losing saved ranges', () => {
  const h = harness(); h.addFallback(); h.showRightColumn(true); h.parent.height = 0; h.host.setView(h.saved());
  assert.equal(h.parent.children[0].id, IN_PAGE_HOST_ID, 'an empty column with nonzero width is a valid anchor');
  const first = h.parent.children[0], container = h.renders.at(-1).container;
  h.showRightColumn(false); h.host.setContext({ ...h.live(), currentTime: 460 });
  assert.deepEqual(h.parent.children, []);
  assert.deepEqual(h.below.children, [first]);
  assert.equal(h.renders.at(-1).container, container);
  assert.deepEqual(h.renders.at(-1).view.ranges, [[10, 20], [80, 90]]);
  h.showRightColumn(true); h.host.setContext(h.live());
  assert.deepEqual(h.below.children, []);
  assert.deepEqual(h.parent.children, [first]);
  assert.equal(h.renders.at(-1).container, container);
  assert.equal(h.nodes.filter((node) => node.id === IN_PAGE_HOST_ID).length, 1);
});

test('no right-column anchor leaves YouTube unchanged', () => {
  const h = harness(); h.removeParent(); h.host.setContext(h.live()); h.host.setView(h.saved());
  assert.equal(h.renders.length, 0);
  assert.equal(h.nodes.length, 0);
});

test('destroy detaches once and ignores subsequent recorder callbacks', () => {
  const h = harness(); h.host.setView(h.saved()); const count = h.renders.length;
  const shadow = h.parent.children[0].shadowRoot;
  for (const type of ['keydown', 'keypress', 'keyup']) assert.equal(shadow.listeners.get(type).size, 1);
  h.host.setContext(h.live());
  for (const type of ['keydown', 'keypress', 'keyup']) assert.equal(shadow.listeners.get(type).size, 1, 'recorder ticks cannot duplicate keyboard guards');
  const rendersBeforeDestroy = h.renders.length;
  h.host.destroy(); h.host.destroy(); h.host.setContext(h.live()); h.host.setView(h.saved()); h.host.setError('late', A);
  assert.equal(h.parent.children.length, 0);
  assert.equal(h.unmounted, 1);
  assert.equal(h.renders.length, rendersBeforeDestroy);
  assert.equal(rendersBeforeDestroy, count + 1);
  for (const type of ['keydown', 'keypress', 'keyup']) assert.equal(shadow.listeners.get(type).size, 0, 'destroy releases task-owned listeners');
});
