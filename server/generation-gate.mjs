// One process-wide gate is injected into both model consumers by startServer.
// These counters are conservative local limits, not persistent project quotas
// or a billing firewall. Project ownership/unbilled status is audited separately.
const PROJECT = 'gen-lang-client-0441267635';
const MODEL = 'gemini-3.8-flash';
const KEY_RESOURCE = /^projects\/2937676390\/locations\/global\/keys\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const PAID_KEY_RESOURCE = 'projects/2937676390/locations/global/keys/c8631e91-1d44-4033-a5b6-1857223f4778';
const METERED_STUDY_SCOPE = 'metered-study';
const pacificDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });

export function createGenerationGate({ env = process.env, now = Date.now } = {}) {
  const freeOnly = env.GEMINI_FREE_TIER_ONLY === 'true';
  const paidApproved = env.GEMINI_FREE_TIER_ONLY === 'false'
    && env.GEMINI_PAID_BUDGET_APPROVED === 'true' && env.STUDY_PROJECT_BUDGET_USD === '10';
  const paidSignals = env.GEMINI_PAID_BUDGET_APPROVED !== undefined || env.STUDY_PROJECT_BUDGET_USD !== undefined;
  // Truly unset local configurations retain their original behavior. An
  // explicit non-free flag or any paid signal can never enter that branch.
  const invalidPolicy = freeOnly ? env.GEMINI_PAID_BUDGET_APPROVED === 'true'
    : !paidApproved && (env.GEMINI_FREE_TIER_ONLY !== undefined || paidSignals);
  let day = pacificDay.format(now()); let requestsToday = 0;
  let recent = []; let blockedUntil = 0; let billingBlocked = false;
  function refresh() {
    const time = now(); const currentDay = pacificDay.format(time);
    if (currentDay !== day) { day = currentDay; requestsToday = 0; }
    recent = recent.filter((at) => time - at < 60000);
  }
  function policyReason({ transport = env.AI_PROVIDER, model = env.GEMINI_MODEL, scope } = {}) {
    if (env.AI_GENERATION_DISABLED === 'true') return 'generation_disabled';
    if (invalidPolicy) return 'paid_route_not_verified';
    if (freeOnly && (transport !== 'gemini' || env.AI_PROVIDER !== 'gemini' || model !== MODEL
      || env.GEMINI_MODEL !== MODEL || env.GEMINI_API_PROJECT !== PROJECT || !KEY_RESOURCE.test(env.GEMINI_API_KEY_RESOURCE || ''))) return 'free_route_not_verified';
    if (paidApproved) {
      if (transport !== 'gemini' || env.AI_PROVIDER !== 'gemini' || model !== MODEL || env.GEMINI_MODEL !== MODEL
        || env.GEMINI_API_PROJECT !== PROJECT || env.GEMINI_API_KEY_RESOURCE !== PAID_KEY_RESOURCE) return 'paid_route_not_verified';
      // Only the server-owned StudyProvider sets this scope. Legacy consumers
      // have no durable user/project dollar reservation and stay unavailable.
      if (scope !== METERED_STUDY_SCOPE) return 'metered_route_required';
    }
    if (billingBlocked || paidApproved && env.GEMINI_BILLING_PAUSED === 'true') return 'provider_billing_required';
    if (now() < blockedUntil || (freeOnly && (recent.length >= 5 || requestsToday >= 20))) return 'free_tier_quota_exhausted';
    return null;
  }
  function retryAfterSeconds() {
    let until = blockedUntil;
    if (freeOnly && recent.length >= 5) until = Math.max(until, recent[0] + 60000);
    if (freeOnly && requestsToday >= 20) {
      // Search at most 26 hours for the next Pacific day, including DST days,
      // then narrow to the minute. No dependency on the host's timezone.
      let next = now();
      for (let hour = 0; hour < 26 && pacificDay.format(next) === day; hour++) next += 3600000;
      while (pacificDay.format(next - 60000) !== day) next -= 60000;
      until = Math.max(until, next);
    }
    return Math.max(1, Math.ceil((until - now()) / 1000));
  }
  const rejection = (reason) => reason ? { reason, ...(reason === 'free_tier_quota_exhausted' ? { retryAfterSeconds: retryAfterSeconds() } : {}) } : null;
  return {
    reason(context) { refresh(); return policyReason(context); },
    reserve(context) {
      refresh(); const reason = policyReason(context);
      if (reason) return rejection(reason);
      if (freeOnly) { recent.push(now()); requestsToday++; }
      return null;
    },
    observeResponse(status, retryAfter) {
      if (status === 402) { billingBlocked = true; return rejection('provider_billing_required'); }
      if (status !== 429) return null;
      // Never retain provider bodies, raw headers, key-bearing URLs or retries.
      const seconds = typeof retryAfter === 'string' && /^\d{1,6}$/.test(retryAfter) ? Math.min(86400, Math.max(1, Number(retryAfter))) : 60;
      blockedUntil = Math.max(blockedUntil, now() + seconds * 1000);
      return rejection('free_tier_quota_exhausted');
    },
    status() {
      refresh();
      const reason = policyReason(paidApproved ? {scope:METERED_STUDY_SCOPE} : undefined);
      return { freeTierOnly: freeOnly, apiProject: freeOnly || paidApproved ? PROJECT : null,
        ...(paidApproved ? {paidBudgetApproved:true,projectBudgetUsd:10} : {}),
        ...(freeOnly ? { requestsPerMinute: 5, requestsPerPacificDay: 20, requestsToday, counterScope: 'process; provider project quota remains authoritative' } : {}),
        ...(reason === 'free_tier_quota_exhausted' ? { retryAfterSeconds: retryAfterSeconds() } : {}), reason };
    },
  };
}
