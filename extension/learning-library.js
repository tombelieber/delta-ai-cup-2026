import { validVideoId, youtubeVideoId } from './store.js';
import { LEARNING_PILOT } from './learning-source.js';
import { LEARNING_STORE_PREFIX } from './learning-protocol.js';
import { SKILLS_STORE_KEY, normalizeSkills } from '../src/learning/skill-records.mjs';
import { HISTORY_IMPORT_KEY, normalizeImportedHistory } from './history-import.js';
import { buildLearningJournal } from './learning-journal.js';
import { ACCOUNT_HISTORY_KEY, normalizeAccountHistory } from './account-history.js';

export const LEARNING_LIBRARY_KEY = 'delta.learning.library.v1';
export const PANEL_INTENT_KEY = 'delta.learning.panel-intent.v1';
const pilotTitle = 'How to use SUMIF and SUMIFS in Microsoft Excel';
const normalize = value => ({ schemaVersion: 1,
  items: Object.fromEntries(Object.entries(value?.items || {}).filter(([id]) => id === LEARNING_PILOT.videoId)
    .map(([id, item]) => [id, { videoId: id, title: typeof item?.title === 'string' ? item.title.slice(0, 300) : pilotTitle,
      enrolledAt: Number.isFinite(item?.enrolledAt) ? item.enrolledAt : 0 }])),
  dismissed: [...new Set((Array.isArray(value?.dismissed) ? value.dismissed : []).filter(validVideoId))].slice(-1000),
});

export async function learningEntryState(storage, videoId) {
  if (!validVideoId(videoId)) return { learningDismissed: false, learningEnrolled: false };
  const key = `${LEARNING_STORE_PREFIX}${videoId}`;
  const saved = await storage.get(LEARNING_LIBRARY_KEY);
  const library = normalize(saved[LEARNING_LIBRARY_KEY]);
  // Preserve an existing lesson as saved learning when upgrading.
  const workspace = videoId === LEARNING_PILOT.videoId ? (await storage.get(key))[key]?.value : null;
  return { learningDismissed: library.dismissed.includes(videoId),
    learningEnrolled: Boolean(library.items[videoId] || workspace?.lesson) };
}

export function createLearningLibrary({ api, repository, readEndpoint, panelSender, contentSender, now = Date.now }) {
  let writes = Promise.resolve();
  const serialize = operation => { const result = writes.then(operation, operation); writes = result.catch(() => {}); return result; };
  function authorize(sender, videoId, nativeOnly = false) {
    if (!panelSender(sender) && (nativeOnly || !contentSender(sender))) throw Error('This action is only available in Delta.');
    if (videoId !== undefined && (!validVideoId(videoId) || contentSender(sender) && youtubeVideoId(sender.url) !== videoId)) {
      throw Error('Use the current YouTube video for this action.');
    }
  }
  async function list(sender) {
    authorize(sender, undefined, true);
    const endpoint = await readEndpoint();
    const library = normalize((await api.storage.local.get(LEARNING_LIBRARY_KEY))[LEARNING_LIBRARY_KEY]);
    const key = `${LEARNING_STORE_PREFIX}${LEARNING_PILOT.videoId}`;
    const workspace = (await api.storage.local.get(key))[key];
    if (workspace?.value?.lesson && !library.items[LEARNING_PILOT.videoId]) library.items[LEARNING_PILOT.videoId] = {
      videoId: LEARNING_PILOT.videoId, title: pilotTitle, enrolledAt: 0,
    };
    const record = normalizeSkills((await api.storage.local.get(SKILLS_STORE_KEY))[SKILLS_STORE_KEY]?.value);
    const tasks = record.evidence.filter(e => e.origin === endpoint).map(e => ({ taskId: e.taskId, total: e.actualTotal, checkedAt: e.checkedAt, formula: e.formula }));
    const items = Object.values(library.items).map(item => ({ ...item,
      url: `https://www.youtube.com/watch?v=${item.videoId}&t=35s`,
      hasLesson: Boolean(workspace?.endpoint === endpoint && workspace.value?.lesson),
      tasks,
    }));
    const data = await repository.read();
    const imported = normalizeImportedHistory((await api.storage.local.get(HISTORY_IMPORT_KEY))[HISTORY_IMPORT_KEY], now());
    const accountHistory = normalizeAccountHistory((await api.storage.local.get(ACCOUNT_HISTORY_KEY))[ACCOUNT_HISTORY_KEY], now());
    const activeHistory = accountHistory.accounts[accountHistory.activeAccountKey];
    // Retain existing checked evidence in the journal even if its old workspace
    // was removed. This does not enrol it again or change the legacy item list.
    const journalItems = items.length || !tasks.length ? items : [{ videoId: LEARNING_PILOT.videoId, title: pilotTitle, hasLesson: false, tasks }];
    return { ok: true, endpoint, items, journal: { ...buildLearningJournal({ data, visits: imported.visits, items: journalItems,
      accountEntries: activeHistory?.entries || [] }), account: activeHistory?.account || null } };
  }
  async function enrol(videoId, sender) {
    authorize(sender, videoId);
    if (videoId !== LEARNING_PILOT.videoId) throw Error('Use the supported SUMIF video to start this saved lesson.');
    return serialize(async () => {
      const data = await repository.read();
      const library = normalize((await api.storage.local.get(LEARNING_LIBRARY_KEY))[LEARNING_LIBRARY_KEY]);
      if (!library.items[videoId]) {
        library.items[videoId] = { videoId, title: data.videos[videoId]?.title || pilotTitle, enrolledAt: now() };
        await api.storage.local.set({ [LEARNING_LIBRARY_KEY]: library });
      }
      return { ok: true };
    });
  }
  async function dismiss(videoId, sender) {
    authorize(sender, videoId);
    return serialize(async () => {
      const library = normalize((await api.storage.local.get(LEARNING_LIBRARY_KEY))[LEARNING_LIBRARY_KEY]);
      if (!library.dismissed.includes(videoId)) { library.dismissed = [...library.dismissed, videoId].slice(-1000); await api.storage.local.set({ [LEARNING_LIBRARY_KEY]: library }); }
      return { ok: true };
    });
  }
  return { list, enrol, dismiss };
}
