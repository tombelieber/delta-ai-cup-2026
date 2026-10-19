import {createHash, randomUUID} from 'node:crypto';
import {normalizeInput, MapClassificationError, SYSTEM_INSTRUCTION} from '../map-classification.mjs';
import {StudyError, requireStudy} from './source.mjs';
import {PROJECT_BUDGET_ENFORCED} from './project-budget.mjs';
import {sanitizeStudyDiagnostics} from './diagnostics.mjs';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 256;
const MAX_INFLIGHT = 32;
const VERSION = 'metered-metadata-map-v1';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mapError = error => {
  if (!(error instanceof MapClassificationError)) return error;
  return Object.assign(new StudyError(error.code, error.status),
    error.retryAfterSeconds ? {retryAfterSeconds: error.retryAfterSeconds} : {},
    error.diagnostics ? {diagnostics:sanitizeStudyDiagnostics(error.diagnostics)} : {});
};

// Metadata exists only in the active request. Cache keys are UID-bound hashes;
// cached values contain the public classification result, never video titles.
export function createStudyClassificationService({provider, accounts, paidAccounts, env=process.env, now=Date.now}={}) {
  requireStudy(env.GEMINI_PAID_BUDGET_APPROVED !== 'true' || env.STUDY_ACCESS_MODE === 'google'
    && accounts?.[PROJECT_BUDGET_ENFORCED] === true, 'project_budget_configuration_invalid',503);
  requireStudy(typeof accounts?.forUser === 'function' && typeof provider?.classifyMetadata === 'function',
    'classification_unavailable',503);
  const cache = new Map(), inflight = new Map();
  function prune() {
    const time = now();
    for (const [key, entry] of cache) if (entry.expiresAt <= time) cache.delete(key);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }
  function response(items, videos, cached) {
    const byId = new Map(items.map(item => [item.videoId,item]));
    const unresolvedIds = videos.filter(video => !byId.has(video.videoId)).map(video => video.videoId);
    return {schemaVersion:1,model:env.GEMINI_MODEL,cached,
      items:videos.filter(video => byId.has(video.videoId)).map(video => structuredClone(byId.get(video.videoId))),
      ...(unresolvedIds.length ? {unresolvedIds} : {})};
  }
  async function classify(input, context) {
    const uid = context?.principal?.uid;
    requireStudy(typeof uid==='string' && uid.length>0 && uid.length<=128,'authentication_required',401);
    const funding=input?.funding||'free';requireStudy(['free','paid'].includes(funding),'invalid_funding');
    requireStudy(funding!=='paid'||paidAccounts?.[PROJECT_BUDGET_ENFORCED]===true,'payments_unavailable',503);
    let normalized;
    try {const {funding:_funding,...metadata}=input||{};normalized=normalizeInput(metadata);} catch(error) {throw mapError(error);}
    requireStudy(normalized.videos.length<=12,'invalid_classification_input',400);
    const canonical = {videos:[...normalized.videos].sort((a,b)=>a.videoId.localeCompare(b.videoId,'en')),
      existingPaths:normalized.existingPaths.map(path=>[...path]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'))};
    const key=hash({kind:VERSION,uid,model:env.GEMINI_MODEL,prompt:SYSTEM_INSTRUCTION,input:canonical,...(funding==='paid'?{funding}:{})});
    prune();
    const saved=cache.get(key);
    if(saved) {
      cache.delete(key);cache.set(key,saved);
      return response(saved.items,normalized.videos,saved.items.length);
    }
    const active=inflight.get(key);
    if(active)return response(await active,normalized.videos,0);
    requireStudy(inflight.size<MAX_INFLIGHT,'classification_busy',429,'Map analysis is busy. Your saved map is kept.');
    const operation=(async()=>{
      const account=(funding==='paid'?paidAccounts:accounts).forUser(uid,{kind:'classification'}),operationId=randomUUID();
      await account.check();
      let reserved=false;
      const budget={
        async reserve(amountUsd) {
          requireStudy(Number.isFinite(amountUsd)&&amountUsd>0&&amountUsd<.1,'video_budget_exceeded',429);
          requireStudy(!reserved,'credit_operation_conflict',409);
          const reservation=await account.reserve({operationId,sessionId:key,amountUsd});
          requireStudy(reservation?.created===true,'credit_operation_conflict',409);
          reserved=true;
        },
        async settle(actualUsd) {
          requireStudy(reserved,'credit_operation_conflict',409);
          await account.settle({operationId,actualUsd});
          const session=await account.session(key);
          requireStudy(session.available&&session.conservativeUsd<.1,'video_budget_exceeded',429);
        },
        async failure() {
          if(reserved)await account.failure({operationId});
        },
      };
      let items;
      try {items=await provider.classifyMetadata({...canonical,budget});}catch(error){throw mapError(error);}
      // Confidence is the model's enum, never a calibrated accuracy estimate.
      // Medium/low suggestions remain unresolved instead of becoming user data.
      const high=items.filter(item=>item.confidence==='high');
      cache.set(key,{items:structuredClone(high),expiresAt:now()+CACHE_TTL_MS});prune();
      return high;
    })();
    inflight.set(key,operation);
    try {return response(await operation,normalized.videos,0);}
    finally {if(inflight.get(key)===operation)inflight.delete(key);}
  }
  return {classify};
}
