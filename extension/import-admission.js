import {openHostedAction} from './hosted-action-client.js';
import {importPayload,importReceipt} from './import-contract.js';

// Uses the same nonce/tab/origin-bound broker as map classification. Identity tokens
// stay in the website. Callers must recheck their source before committing locally.
export function createImportAdmission({api,broker}){
  const bridgeApi={storage:api.storage,runtime:{sendMessage:message=>broker.handleInternal(message,
    {id:api.runtime.id,url:api.runtime.getURL('background.js')})}};
  return (payload,{signal}={})=>openHostedAction({action:'imports',payload,signal},{api:bridgeApi});
}
export async function admitImportBatch(admitImports,jobId,videoIds,signal){
  if(typeof admitImports!=='function')throw Error('Sign in through the Delta website to verify your import allowance. Your saved records are kept.');
  const ids=[...new Set(videoIds)],encoded=new TextEncoder().encode([...ids].sort().join('\0'));
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded)),v=>v.toString(16).padStart(2,'0')).join('');
  const payload=importPayload({operationId:`${jobId}_${digest}`,videoIds:ids});
  const result=importReceipt(await admitImports(payload,{signal}),payload);
  if(signal.aborted)throw Object.assign(Error('Import stopped. Your saved records are kept.'),{code:'CANCELLED'});
  return result;
}
export function importAdmissionMessage(error){
  if(['QUOTA','CANCELLED','AUTH_REQUIRED','HOSTED_UNAVAILABLE','TIMEOUT'].includes(error?.code))return String(error.message).slice(0,300);
  return 'Import allowance could not be verified. Open the Delta website and sign in, then try again. Your saved records are kept.';
}
