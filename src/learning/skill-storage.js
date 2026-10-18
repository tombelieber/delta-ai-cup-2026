import { SKILLS_STORE_KEY } from './skill-records.mjs';

// Website-origin storage is independent of the extension's Chrome profile.
// Locks plus revisions stop a stale tab from overwriting a newer correction.
export function createWebSkillStorage({ storage, events, locks } = {}) {
  let revision = null;
  const writerId = crypto.randomUUID();
  const target = () => storage || globalThis.localStorage;
  const read = () => {
    const raw = target().getItem(SKILLS_STORE_KEY);
    if (raw == null) return { revision: 0, value: null };
    const saved = JSON.parse(raw);
    if (Number.isSafeInteger(saved?.revision) && saved.revision >= 0 && Object.hasOwn(saved, 'value')) return saved;
    return { revision: 0, value: saved };
  };
  return {
    async get() { const saved = read(); revision = saved.revision; return saved.value; },
    async set(_key, value) {
      if (revision === null) throw Error('Read the skill record before saving.');
      const update = () => {
        const saved = read();
        if (JSON.stringify(saved.value) === JSON.stringify(value)) { revision = saved.revision; return; }
        if (saved.revision !== revision) throw Error('Another Delta tab changed your skill record. Reload it before saving.');
        const next = saved.revision + 1;
        target().setItem(SKILLS_STORE_KEY, JSON.stringify({ revision: next, writerId, value }));
        revision = next;
      };
      const coordinator = locks || globalThis.navigator?.locks;
      if (!coordinator?.request) throw Error('Safe local skill storage is unavailable in this browser. Your saved record is unchanged.');
      await coordinator.request(SKILLS_STORE_KEY, update);
    },
    subscribe(listener) {
      const source = events || globalThis.window;
      const onChange = event => { if (event.key === SKILLS_STORE_KEY) listener({ reason: 'external' }); };
      source?.addEventListener('storage', onChange);
      return () => source?.removeEventListener('storage', onChange);
    },
  };
}
