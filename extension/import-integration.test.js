import test from 'node:test';
import assert from 'node:assert/strict';
import {installBackground} from './background.js';
import {HISTORY_IMPORT_KEY} from './history-import.js';
import {ACCOUNT_HISTORY_KEY} from './account-history.js';
import {HOSTED_ACTIONS_KEY} from './hosted-actions.js';
import {DEFAULT_API_ENDPOINT} from './analysis-client.js';
import {createStudyClient} from '../src/learning/study-client.mjs';
import {createServer} from '../server/index.mjs';
import {createStudyEntitlements} from '../server/study/entitlements.mjs';
import {StudyError} from '../server/study/source.mjs';

const id='abcdefghijklmnopabcdefghijklmnop',panel={id,url:`chrome-extension://${id}/panel.html`},time=Date.UTC(2026,9,20);
const video=n=>String(n).padStart(11,'0'),identity={key:'channel:@example',label:'Example'};
const event=()=>{const listeners=new Set();return {addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f),emit:(...args)=>{for(const f of listeners)f(...args);},get listeners(){return [...listeners];}};};
async function fixture(t){
  // External I/O seams only: token verification and transactional persistence.
  const docs=new Map();let chain=Promise.resolve();
  const store={transact(user,op,ids,reduce){const pending=chain.then(()=>{
    const read=k=>structuredClone(docs.get(k)??null),next=reduce(read(user),op?read(`${user}/op/${op}`):null,ids.map(v=>read(`${user}/video/${v}`)));
    if(next.account)docs.set(user,next.account);if(next.operation)docs.set(`${user}/op/${op}`,next.operation);
    for(const [key,value]of next.registrations||[])docs.set(`${user}/video/${key}`,value);return next.result;
  });chain=pending.catch(()=>{});return pending;}};
  const entitlements=createStudyEntitlements({store,key:Buffer.alloc(32,47)});
  const accounts={config:()=>({enabled:true,firebase:{authDomain:'test.firebaseapp.com'}}),async authenticate(req){if(!['Bearer alice','Bearer bob'].includes(req.headers.authorization))throw new StudyError('authentication_required',401);return {uid:req.headers.authorization.slice(7)};},forUser:()=>({snapshot:async()=>({limitUsd:.5,spentUsd:0,reservedUsd:0,remainingUsd:.5})})};
  const server=createServer({studyService:{access:{mode:'google',check:()=>null}},studyAccounts:accounts,studyEntitlements:entitlements,requestsPerMinute:200});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const endpoint=`http://127.0.0.1:${server.address().port}`,onChanged=event();
  function area(name){let values={};return {async get(key){return {[key]:structuredClone(values[key])};},async set(update){const changes={};for(const [key,value]of Object.entries(update)){changes[key]={oldValue:values[key],newValue:structuredClone(value)};values[key]=structuredClone(value);}onChanged.emit(changes,name);},async remove(key){delete values[key];},snapshot:()=>structuredClone(values)};}
  const tabs=new Map();let nextTab=0,notifySite;
  const api={runtime:{id,getURL:path=>`chrome-extension://${id}/${path}`,onMessage:event(),onMessageExternal:event(),onInstalled:event(),onStartup:event()},storage:{onChanged,local:area('local'),session:area('session')},permissions:{contains:async()=>true},history:{search:async({text})=>text==='youtube.com'?Array.from({length:11},(_,n)=>({url:`https://www.youtube.com/watch?v=${video(n)}`,title:`Example ${n}`,lastVisitTime:time-1000-n})):[]},sidePanel:{setOptions:async()=>{}},tabs:{onUpdated:event(),onRemoved:event(),async query(){return [];},async create(value){const tab={...value,id:++nextTab,status:'complete'};tabs.set(tab.id,tab);return tab;},async update(tabId,value){Object.assign(tabs.get(tabId),value);notifySite?.();},async get(tabId){return tabs.get(tabId);},async sendMessage(){return {ok:true,ready:true,account:identity};}}};
  const background=installBackground(api,()=>time),send=message=>background.handle(message,panel);
  const nextSite=()=>new Promise(resolve=>{notifySite=resolve;});
  async function website(uid='alice'){
    const pending=Object.values(api.storage.session.snapshot()[HOSTED_ACTIONS_KEY].pending)[0],sender={url:tabs.get(pending.tabId).url,origin:DEFAULT_API_ENDPOINT,frameId:0,tab:{id:pending.tabId}};
    const external=message=>new Promise(resolve=>api.runtime.onMessageExternal.listeners.at(-1)({...message,requestId:pending.nonce},sender,resolve));
    const action=await external({type:'DELTA_HOSTED_ACTION_GET'});assert.equal(action.action,'imports');
    const client=createStudyClient({endpoint,userId:uid,getToken:async()=>uid});
    try{const result=await client.registerImports(action.payload);assert.equal((await external({type:'DELTA_HOSTED_ACTION_RESULT',result})).ok,true);return result;}
    catch(error){await external({type:'DELTA_HOSTED_ACTION_ERROR',status:error.status});return error;}
  }
  return {api,background,send,nextSite,website,entitlements};
}

test('real background Chrome import -> hosted bridge -> HTTP ledger -> local persistence, then eleventh denial',async t=>{
  const f=await fixture(t);await f.api.storage.local.set({savedLesson:{id:'legacy-do-not-touch'}});
  async function importSelection(ids){const preview=await f.send({type:'HISTORY_PREVIEW',days:30}),opened=f.nextSite(),saving=f.send({type:'HISTORY_IMPORT',token:preview.token,videoIds:ids});const outcome=saving.then(value=>({value}),error=>({error}));await opened;return {outcome,receipt:await f.website()};}
  const first=await importSelection(Array.from({length:10},(_,n)=>video(n)));
  assert.equal(first.receipt.added,10);assert.equal((await first.outcome).value.visits.length,10);
  const repeated=await importSelection([video(0)]);assert.equal(repeated.receipt.added,0);assert.equal((await repeated.outcome).value.visits.length,10);
  const denied=await importSelection([video(10)]);assert.equal(denied.receipt.status,402);assert.match((await denied.outcome).error.message,/remaining history allowance/);
  assert.equal(f.api.storage.local.snapshot()[HISTORY_IMPORT_KEY].visits.length,10);assert.deepEqual(f.api.storage.local.snapshot().savedLesson,{id:'legacy-do-not-touch'});
  assert.equal((await f.entitlements.forUser('alice').snapshot()).imports.remaining,0);assert.equal((await f.entitlements.forUser('bob').snapshot()).imports.remaining,10);
});
test('real background YouTube account collector defaults to ten and shares the same admission path',async t=>{
  const f=await fixture(t);await f.send({type:'ACCOUNT_HISTORY_OPEN'});const state=await f.send({type:'ACCOUNT_HISTORY_STATUS'});
  const confirmed=await f.send({type:'ACCOUNT_HISTORY_CONFIRM',jobId:state.session.id,accountKey:identity.key});assert.equal(confirmed.session.range,'latest10');
  const opened=f.nextSite(),saving=f.background.handle({type:'ACCOUNT_HISTORY_BATCH',jobId:state.session.id,accountKey:identity.key,rows:[{videoId:video(0),url:`https://www.youtube.com/watch?v=${video(0)}`,title:'Example',kind:'video',date:null,datePrecision:'unknown',pageOrder:0}]},{id,url:'https://www.youtube.com/feed/history',frameId:0,tab:{id:state.session.tabId}});
  await opened;assert.equal((await f.website('bob')).added,1);assert.equal((await saving).added,1);
  assert.equal(f.api.storage.local.snapshot()[ACCOUNT_HISTORY_KEY].accounts[identity.key].entries.length,1);
  assert.equal((await f.entitlements.forUser('bob').snapshot()).imports.remaining,9);
});
