import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostedActionBroker, HOSTED_ACTIONS_KEY, hostedActionResultKey } from './hosted-actions.js';
import { openHostedAction } from './hosted-action-client.js';
import { DEFAULT_API_ENDPOINT } from './analysis-client.js';
import { PANEL_INTENT_KEY } from './learning-library.js';

const extensionId='abcdefghijklmnopabcdefghijklmnop',videoId='733mgqrzNKs';
const native={id:extensionId,url:`chrome-extension://${extensionId}/panel.html`};
const metadata={videos:[{videoId,title:'Time value of money',privateHistory:'never cross'}],existingPaths:[]};
const classification={schemaVersion:1,items:[{videoId,path:['Finance','Time value'],confidence:'high',contentType:'knowledge'}],cached:0,model:'existing-model'};
function fixture(){
  let time=1000,nonce=0,endpoint=DEFAULT_API_ENDPOINT,values={};const tabs=new Map([[7,{id:7,url:`https://www.youtube.com/watch?v=${videoId}`,title:'Time value'}]]),calls=[];
  const listeners=new Set();const api={runtime:{id:extensionId,getURL:path=>`chrome-extension://${extensionId}/${path}`},storage:{onChanged:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},session:{
    async get(key){return {[key]:structuredClone(values[key])};},async set(update){const changes={};for(const [key,value]of Object.entries(update)){changes[key]={oldValue:values[key],newValue:structuredClone(value)};values[key]=structuredClone(value);}for(const listener of listeners)listener(changes,'session');},async remove(key){delete values[key];}
  }},tabs:{async get(id){return tabs.get(id);},async query(){return [tabs.get(7)];},async create(value){const tab={id:10+tabs.size,...value};tabs.set(tab.id,tab);calls.push(['create',value]);return tab;},async update(id,value){Object.assign(tabs.get(id),value);calls.push(['update',id,value]);},async sendMessage(id,value){calls.push(['capture',id,value]);return {ok:true,videoId,title:'Time value',url:`https://www.youtube.com/watch?v=${videoId}`,start:0,end:300,transcript:'0:00 Real caption text.\n0:20 Interest grows.'};}}};
  const make=()=>createHostedActionBroker({api,readEndpoint:async()=>endpoint,panelSender:sender=>sender?.id===extensionId&&sender.url?.startsWith(api.runtime.getURL('')),now:()=>time,randomId:()=>String(++nonce).padStart(32,'a')});
  let broker=make();api.runtime.sendMessage=message=>broker.handleInternal(message,native);
  const request=(action='classify',extra={})=>broker.handleInternal({type:'DELTA_HOSTED_ACTION_OPEN',action,requestId:crypto.randomUUID(),...(action==='classify'?{payload:metadata}:{videoId}),...extra},native);
  const external=opened=>({url:tabs.get(opened.tabId).url,origin:DEFAULT_API_ENDPOINT,frameId:0,tab:{id:opened.tabId}});
  return {api,calls,tabs,request,external,get broker(){return broker;},restart(){broker=make();},advance(ms){time+=ms;},endpoint(value){endpoint=value;},values:()=>values};
}
test('hosted classify transfers only bounded public metadata to the exact created tab',async()=>{
  const f=fixture(),opened=await f.request(),sender=f.external(opened);
  const value=await f.broker.handleExternal({type:'DELTA_HOSTED_ACTION_GET',requestId:opened.nonce},sender);
  assert.deepEqual(value.payload,{videos:[{videoId,title:'Time value of money'}],existingPaths:[]});
  assert.equal(value.action,'classify');assert.equal(new URL(sender.url).searchParams.get('request'),opened.nonce);
  assert.equal(sender.url.includes('Time%20value'),false);assert.equal(sender.url.includes('privateHistory'),false);
});
test('external bridge rejects wrong origin, foreign extension, tab, frame, path and nonce',async()=>{
  const f=fixture(),opened=await f.request(),sender=f.external(opened),message={type:'DELTA_HOSTED_ACTION_GET',requestId:opened.nonce};
  for(const bad of [{...sender,origin:'https://evil.test'},{...sender,id:'another-extension'},{...sender,tab:{id:99}},{...sender,frameId:1},{...sender,url:sender.url.replace('/learn?','/other?')},{...sender,url:sender.url.replace('run.app','run.app.evil.test')}])await assert.rejects(f.broker.handleExternal(message,bad));
  await assert.rejects(f.broker.handleExternal({...message,requestId:'b'.repeat(32)},sender));
});
test('pending data survives worker restart but cannot be read after expiry',async()=>{
  const f=fixture(),opened=await f.request();f.restart();
  assert.equal((await f.broker.handleExternal({type:'DELTA_HOSTED_ACTION_GET',requestId:opened.nonce},f.external(opened))).action,'classify');
  f.advance(600001);await assert.rejects(f.broker.handleExternal({type:'DELTA_HOSTED_ACTION_GET',requestId:opened.nonce},f.external(opened)));
  assert.equal(Object.keys(f.values()[HOSTED_ACTIONS_KEY].pending).length,0);
});
test('classify completion validates expected IDs and emits one sanitized storage result',async()=>{
  const f=fixture(),opened=await f.request(),sender=f.external(opened);
  await assert.rejects(f.broker.handleExternal({type:'DELTA_HOSTED_ACTION_RESULT',requestId:opened.nonce,result:{...classification,items:[{...classification.items[0],videoId:'abcdefghijk'}]}},sender));
  await f.broker.handleExternal({type:'DELTA_HOSTED_ACTION_RESULT',requestId:opened.nonce,result:{...classification,idToken:'never persist'}},sender);
  const saved=f.values()[hostedActionResultKey(opened.requestId)];assert.equal(saved.status,'complete');assert.equal(saved.result.items[0].videoId,videoId);assert.equal(JSON.stringify(saved).includes('idToken'),false);
  await assert.rejects(f.broker.handleExternal({type:'DELTA_HOSTED_ACTION_RESULT',requestId:opened.nonce,result:classification},sender));
});
test('internal bridge denies web content and arbitrary destination origins',async()=>{
  const f=fixture();await assert.rejects(f.broker.handleInternal({type:'DELTA_HOSTED_ACTION_OPEN',action:'classify',payload:metadata,requestId:crypto.randomUUID()},{...native,url:'https://evil.test/'}));
  f.endpoint('https://evil.test');await assert.rejects(f.request());assert.equal(f.calls.length,0);
  f.endpoint('http://127.0.0.1:5173');assert.equal((await f.request()).ok,true);
});
test('classification input rejects batch bounds, duplicates and invalid paths',async()=>{
  const f=fixture();for(const payload of [{videos:Array.from({length:13},()=>({videoId,title:'x'}))},{videos:[{videoId,title:'x'},{videoId,title:'same'}]},{videos:[{videoId,title:'x'}],existingPaths:[['https://evil.test','Other']]}])await assert.rejects(f.request('classify',{payload}));
  assert.equal(f.calls.length,0);
});
test('learn captures only matching source video and passes transcript outside the URL',async()=>{
  const f=fixture(),opened=await f.request('learn',{tabId:7,start:0,end:300});
  const capture=f.calls.find(value=>value[0]==='capture');assert.equal(capture[1],7);assert.equal(capture[2].videoId,videoId);
  const got=await f.broker.handleExternal({type:'DELTA_HOSTED_ACTION_GET',requestId:opened.nonce},f.external(opened));
  assert.match(got.payload.transcript,/Real caption/);assert.equal(new URL(f.external(opened).url).searchParams.get('videoId'),videoId);assert.equal(f.external(opened).url.includes('caption'),false);
  await assert.rejects(f.request('learn',{tabId:7,videoId:'abcdefghijk'}));
});
test('history learn searches the exact already-open video when another tab is active',async()=>{
  const f=fixture();f.tabs.set(8,{id:8,url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Other video'});
  f.api.tabs.query=async options=>options.active?[f.tabs.get(8)]:[...f.tabs.values()];
  const opened=await f.request('learn');assert.equal(opened.ok,true);assert.equal(f.calls.find(call=>call[0]==='capture')[1],7);
});
test('a native extension document remains authorized when opened in its own tab',async()=>{
  const f=fixture(),response=await f.broker.handleInternal({type:'DELTA_HOSTED_ACTION_OPEN',action:'classify',requestId:crypto.randomUUID(),payload:metadata},{...native,tab:{id:88}});assert.equal(response.ok,true);
});
test('missing captions retains source identity with a safe explicit fallback',async()=>{
  const f=fixture();f.api.tabs.sendMessage=async()=>({ok:false,code:'CAPTIONS_UNAVAILABLE',error:'Do not expose raw internal text'});
  const opened=await f.request('learn',{tabId:7}),got=await f.broker.handleExternal({type:'DELTA_HOSTED_ACTION_GET',requestId:opened.nonce},f.external(opened));
  assert.equal(got.payload.videoId,videoId);assert.equal(got.payload.transcript,undefined);assert.match(got.payload.captureError,/captions/i);assert.equal(JSON.stringify(got).includes('raw internal'),false);
});
test('closing hosted tab cancels pending work and clears transferred metadata',async()=>{
  const f=fixture(),opened=await f.request();await f.broker.handleTabRemoved(opened.tabId);
  assert.equal(f.values()[hostedActionResultKey(opened.requestId)].status,'cancelled');assert.equal(Object.keys(f.values()[HOSTED_ACTIONS_KEY].pending).length,0);
});
test('pending map is bounded and expiry frees capacity',async()=>{
  const f=fixture();for(let n=0;n<8;n++)await f.request();await assert.rejects(f.request(),/Finish|Close|pending/i);f.advance(600001);assert.equal((await f.request()).ok,true);
});
test('native client resolves through session storage event and removes its observer',async()=>{
  const f=fixture();const promise=openHostedAction({action:'classify',payload:metadata},{api:f.api});
  await new Promise(resolve=>setTimeout(resolve,0));const pending=Object.values(f.values()[HOSTED_ACTIONS_KEY].pending)[0];
  await f.broker.handleExternal({type:'DELTA_HOSTED_ACTION_RESULT',requestId:pending.nonce,result:classification},{url:f.tabs.get(pending.tabId).url,origin:DEFAULT_API_ENDPOINT,frameId:0,tab:{id:pending.tabId}});
  assert.equal((await promise).items[0].videoId,videoId);
});
test('native client cancellation settles without opening a new authenticated action',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(openHostedAction({action:'classify',payload:metadata,signal:controller.signal},{api:f.api}),error=>error.code==='CANCELLED');assert.equal(f.calls.length,0);
});
test('accepted learning consumes only its exact saved panel intent',async()=>{
  const f=fixture();await f.api.storage.session.set({[PANEL_INTENT_KEY]:{tabId:7,videoId,nonce:'intent'}});await f.request('learn',{tabId:7});assert.equal(f.values()[PANEL_INTENT_KEY],undefined);
});
test('quota failure reaches native caller as a safe typed error without raw provider details',async()=>{
  const f=fixture(),promise=openHostedAction({action:'classify',payload:metadata},{api:f.api});await new Promise(resolve=>setTimeout(resolve,0));const pending=Object.values(f.values()[HOSTED_ACTIONS_KEY].pending)[0];
  await f.broker.handleExternal({type:'DELTA_HOSTED_ACTION_ERROR',requestId:pending.nonce,code:'QUOTA',status:429,error:'raw private provider body'},{url:f.tabs.get(pending.tabId).url,origin:DEFAULT_API_ENDPOINT,frameId:0,tab:{id:pending.tabId}});
  await assert.rejects(promise,error=>error.code==='QUOTA'&&error.status===429&&!error.message.includes('raw private'));
});
