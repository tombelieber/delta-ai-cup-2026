import { DEFAULT_API_ENDPOINT, endpointPermission } from './analysis-client.js';

export function createExtensionLearningAdapter({ runtime, videoId, endpoint = DEFAULT_API_ENDPOINT, permissions = null }) {
  const writerId = crypto.randomUUID();
  let revision = 0, hydrated = false, lastNotifiedRevision = -1;
  let skillsRevision = 0, skillsHydrated = false, lastNotifiedSkillsRevision = -1;
  const subscribers = new Set();
  const skillsSubscribers = new Set();
  const notify = (reason, nextRevision) => {
    if (nextRevision === lastNotifiedRevision) return;
    lastNotifiedRevision = nextRevision;
    for (const listener of subscribers) listener({ reason, revision: nextRevision });
  };
  const notifySkills = (reason, nextRevision) => {
    if (nextRevision === lastNotifiedSkillsRevision) return;
    lastNotifiedSkillsRevision = nextRevision;
    for (const listener of skillsSubscribers) listener({ reason, revision: nextRevision });
  };
  async function request(message, conflictNotice = notify) {
    const response = await runtime.sendMessage({ ...message, videoId, expectedEndpoint: endpoint });
    if (!response?.ok) {
      if (response?.conflict) conflictNotice('conflict', response.revision);
      throw Error(response?.error || 'Delta disconnected. Reload the extension.');
    }
    return response;
  }
  const action = (name, payload) => request({ type: 'LEARNING_REQUEST', action: name, payload }).then((response) => response.result);
  return {
    observeContext(context) {
      if (Number.isSafeInteger(context?.skillsRevision) && context.skillsRevision >= 0) {
        if (context.skillsWriterId === writerId) skillsRevision = Math.max(skillsRevision, context.skillsRevision);
        else if (skillsHydrated && context.skillsRevision > skillsRevision) notifySkills('external', context.skillsRevision);
      }
      if (context?.videoId !== videoId || context.learningEndpoint !== endpoint || !Number.isSafeInteger(context.learningRevision)) return;
      if (context.learningWriterId === writerId) { revision = Math.max(revision, context.learningRevision); return; }
      if (hydrated && context.learningRevision > revision) notify('external', context.learningRevision);
    },
    client: {
      evidenceOrigin: endpoint,
      generationPaused: false,
      freeTier: true,
      async authorizeStudy() {
        if (permissions && !await permissions.request({ origins: [endpointPermission(endpoint)] })) throw Error('Learning service access was not allowed. Your saved work stays on this device.');
      },
      async generate(payload) {
        // Native panel calls this directly from the generate button gesture.
        // Content scripts never request browser permissions or expose a URL proxy.
        if (permissions && !await permissions.request({ origins: [endpointPermission(endpoint)] })) throw Error('Learning service access was not allowed. Your watch history stays on this device.');
        return action('generate', payload);
      },
      validate: (payload) => action('validate', payload),
      reteach: (payload) => action('reteach', payload),
      async pptx(payload) {
        const result = await action('pptx', payload);
        const binary = atob(result.base64);
        return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: result.mime });
      },
      interests: () => request({ type: 'LEARNING_INTERESTS' }).then((response) => response.result),
    },
    storage: {
      skills: {
        async get() {
          try {
            const response = await request({ type: 'LEARNING_SKILLS_GET' }, notifySkills);
            skillsRevision = Number.isSafeInteger(response.revision) ? response.revision : 0;
            skillsHydrated = true;
            return response.value;
          } catch (error) { skillsHydrated = false; lastNotifiedSkillsRevision = -1; throw error; }
        },
        async set(key, suppliedValue) {
          if (!skillsHydrated) throw Error('Skill records have not finished loading. Local progress was not overwritten.');
          const value = suppliedValue === undefined ? key : suppliedValue;
          const response = await request({ type: 'LEARNING_SKILLS_SET', value, expectedRevision: skillsRevision, writerId }, notifySkills);
          skillsRevision = Math.max(skillsRevision, response.revision || 0);
          return response;
        },
        subscribe(listener) { skillsSubscribers.add(listener); return () => skillsSubscribers.delete(listener); },
      },
      async get() {
        try {
          const response = await request({ type: 'LEARNING_STATE_GET' });
          revision = Number.isSafeInteger(response.revision) ? response.revision : 0;
          hydrated = true;
          return response.value;
        } catch (error) { lastNotifiedRevision = -1; throw error; }
      },
      async set(_key, value) {
        if (!hydrated) throw Error('The lesson has not finished loading. Local progress was not overwritten.');
        const response = await request({ type: 'LEARNING_STATE_SET', value, expectedRevision: revision, writerId });
        revision = Math.max(revision, response.revision || 0);
        return response;
      },
      subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    },
  };
}
