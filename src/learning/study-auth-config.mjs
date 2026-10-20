export const STUDY_BOOTSTRAP_TIMEOUT_MS = 45000;
const TRANSIENT = new Set([500, 502, 503, 504]);

function backoff(milliseconds, signal) {
  signal.throwIfAborted();
  if (!milliseconds) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {clearTimeout(timer); signal.removeEventListener('abort', aborted);};
    const aborted = () => {cleanup(); reject(signal.reason);};
    const timer = setTimeout(() => {cleanup(); resolve();}, milliseconds);
    signal.addEventListener('abort', aborted, {once: true});
  });
}

// Only public configuration GETs may retry. Never replay authentication,
// payment or AI operations, or treat a denied/invalid response as transient.
export async function readStudyAuthConfig({endpoint = '', fetchImpl = globalThis.fetch, signal,
  timeoutMs = STUDY_BOOTSTRAP_TIMEOUT_MS, retryDelayMs = 500} = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const url = `${endpoint.replace(/\/$/, '')}/api/study/auth-config`;
  for (let attempt = 0; attempt < 2; attempt++) {
    requestSignal.throwIfAborted();
    const response = await fetchImpl(url, {method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: requestSignal});
    if (!response.ok) {
      if (attempt === 0 && TRANSIENT.has(response.status)) {
        await backoff(retryDelayMs, requestSignal);
        continue;
      }
      throw Object.assign(Error('Authentication configuration unavailable.'), {status: response.status});
    }
    const config = await response.json();
    if (typeof config?.enabled !== 'boolean') throw Error('Learning service configuration incomplete.');
    return config;
  }
}
