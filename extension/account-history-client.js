// Account history is read only after a separate, explicit confirmation in the
// native panel. This client never requests Chrome browsing-history permission.
export function createAccountHistoryClient({ runtime } = {}) {
  const available = Boolean(runtime?.id && runtime?.sendMessage);
  async function request(type, extra = {}) {
    if (!available) throw Error('Open Delta in Chrome’s side panel to import YouTube history.');
    const result = await runtime.sendMessage({ type, ...extra });
    if (!result?.ok) throw Error(result?.error || 'YouTube history could not be updated. Your saved records are kept.');
    return result;
  }
  return {
    available,
    status: () => request('ACCOUNT_HISTORY_STATUS'),
    open: range => request('ACCOUNT_HISTORY_OPEN', { range }),
    confirm: (jobId, accountKey) => request('ACCOUNT_HISTORY_CONFIRM', { jobId, accountKey }),
    pause: () => request('ACCOUNT_HISTORY_PAUSE'),
    continueImport: () => request('ACCOUNT_HISTORY_CONTINUE'),
    clear: accountKey => request('ACCOUNT_HISTORY_CLEAR', { accountKey }),
  };
}
