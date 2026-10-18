import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWebMapImport, webMapJournal, createWebMapClient } from './web-map-client.mjs';
import { MAP_HOSTED_ENDPOINT, MapAnalysisError } from '../../extension/map-analysis-client.js';

const A='abcdefghijk',B='lmnopqrstuv',origin=MAP_HOSTED_ENDPOINT;
const imported={schemaVersion:1,videos:[{videoId:A,title:'How cash differs from profit',channel:'Finance lessons',dateLabel:'Yesterday',pageOrder:0},
  {videoId:B,title:'Excel SUMIF tutorial',channel:'Spreadsheet lessons',pageOrder:1}]};
const memoryStorage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};};
function fixture({uid='user-a',storage=memoryStorage(),fetchImpl}={}){
  let current=uid,quota=.5,calls=[];
  const auth={snapshot:()=>({status:current?'signed-in':'signed-out',user:current?{uid:current}:null,quota:{remainingUsd:quota}}),
    async getToken(expected){assert.equal(expected,current);return `token-for-${current}`;},async refreshSession(){}};
  const client=createWebMapClient({uid,auth,endpoint:origin,location:{origin},storage,fetchImpl:fetchImpl||(async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/auth-config'))return new Response(JSON.stringify({enabled:true}));
    assert.equal(url,`${origin}/api/study/classify`);
    const body=JSON.parse(options.body);
    return new Response(JSON.stringify({schemaVersion:1,model:'test-provider',cached:0,items:body.videos.map(video=>({videoId:video.videoId,path:['Learning',video.videoId===A?'Accounting':'Spreadsheets'],confidence:'high',contentType:'knowledge'}))}));
  })});
  return {client,auth,storage,calls,setUser:value=>{current=value;},setQuota:value=>{quota=value;}};
}

test('metadata import deduplicates real IDs without inventing dates, playback or skill evidence',()=>{
  const normalized=normalizeWebMapImport({...imported,videos:[...imported.videos,{...imported.videos[0],pageOrder:2}]});
  assert.equal(normalized.videos.length,2);
  const journal=webMapJournal(normalized);
  assert.equal(journal.entries.length,2);
  assert.equal(journal.entries[0].url,`https://www.youtube.com/watch?v=${A}`);
  assert.equal(journal.entries[0].historyDates[0].date,null);
  assert.equal(journal.entries[0].historyDates[0].dateLabel,'Yesterday');
  for(const entry of journal.entries){assert.equal(entry.watchedSeconds,0);assert.equal(entry.hasPlayback,false);assert.equal(entry.checkedTasks,0);assert.equal(entry.lastActivityAt,null);assert.equal(entry.topicLabel,'Not yet grouped');}
});

test('whole import rejects extra credentials, fabricated history and invalid bounds',()=>{
  for(const value of [{...imported,token:'private'}, {...imported,videos:[{...imported.videos[0],watchedSeconds:80}]},
    {...imported,videos:[{...imported.videos[0],videoId:'bad'}]}, {...imported,videos:[{...imported.videos[0],videoId:12345678901}]}, {...imported,videos:[{...imported.videos[0],title:''}]},
    {...imported,videos:[{...imported.videos[0],pageOrder:100}]}, {...imported,videos:Array.from({length:101},()=>imported.videos[0])}])assert.throws(()=>normalizeWebMapImport(value));
});

test('UID local import does not call AI; explicit Analyze uses authenticated metadata-only request and persists actual validated topics',async()=>{
  const f=fixture();
  await f.client.importRecords(imported);
  assert.equal(f.calls.length,0);
  let snapshot=await f.client.get();assert.equal(snapshot.status.pending,2);assert.equal(snapshot.status.processed,0);assert.equal(snapshot.status.state,'idle');
  await f.client.begin();snapshot=await f.client.classifyNext();
  assert.equal(snapshot.status.processed,2);assert.equal(snapshot.status.pending,0);
  const generation=f.calls.find(call=>call.url.endsWith('/classify'));
  assert.equal(generation.options.headers.Authorization,'Bearer token-for-user-a');
  const payload=JSON.parse(generation.options.body);
  assert.deepEqual(Object.keys(payload.videos[0]).sort(),['channel','title','videoId']);
  assert.equal(snapshot.classifications.assignments[A].path[1],'Accounting');
  f.client.destroy();
  const reopened=fixture({storage:f.storage});assert.equal((await reopened.client.get()).status.processed,2);reopened.client.destroy();
});

test('other accounts cannot read imported records or commit late in-flight classifications',async()=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const f=fixture({fetchImpl:async(url)=>url.endsWith('/auth-config')?new Response('{"enabled":true}'):pending});
  await f.client.importRecords(imported);await f.client.begin();
  const classify=f.client.classifyNext();await new Promise(setImmediate);f.setUser('user-b');
  release(new Response(JSON.stringify({schemaVersion:1,model:'test-provider',cached:0,items:[{videoId:A,path:['Learning','Accounting'],confidence:'high',contentType:'knowledge'}]})));
  await assert.rejects(classify);
  await assert.rejects(f.client.journal());f.client.destroy();
  const other=fixture({uid:'user-b',storage:f.storage});assert.equal((await other.client.journal()).entries.length,0);other.client.destroy();
  const original=fixture({storage:f.storage});assert.equal((await original.client.get()).status.processed,0);original.client.destroy();
});

test('failed provider preserves imported records and credit unavailable prevents another request',async()=>{
  const f=fixture({fetchImpl:async(url)=>url.endsWith('/auth-config')?new Response('{"enabled":true}'):new Response('{"error":"provider_temporarily_unavailable","message":"Service temporarily unavailable."}',{status:503})});
  await f.client.importRecords(imported);await f.client.begin();await assert.rejects(f.client.classifyNext(),MapAnalysisError);
  assert.equal((await f.client.journal()).entries.length,2);assert.equal((await f.client.get()).status.processed,0);
  f.setQuota(0);await assert.rejects(f.client.begin());f.client.destroy();
});

test('website adapter refuses another origin and never borrows unscoped extension data',async()=>{
  const storage=memoryStorage();storage.setItem('delta.map.classifications.v1','{"private":"unscoped"}');
  const f=fixture({storage});assert.equal((await f.client.journal()).entries.length,0);f.client.destroy();
  assert.throws(()=>createWebMapClient({uid:'user-a',auth:{},endpoint:'https://other.example',location:{origin},storage}));
});

test('failed local storage write does not poison later reads or replace the prior import',async()=>{
  const f=fixture();await f.client.importRecords(imported);
  const save=f.storage.setItem;f.storage.setItem=()=>{throw Error('Storage full.');};
  await assert.rejects(f.client.importRecords({schemaVersion:1,videos:[{videoId:'ZYXWVUTSRQP',title:'Another real title',channel:''}]}));
  assert.equal((await f.client.journal()).entries.length,2);
  f.storage.setItem=save;f.client.destroy();
});

test('Stop aborts the website fetch without marking an unfinished batch as reviewed',async()=>{
  let requestSignal;
  const f=fixture({fetchImpl:async(url,options)=>{
    if(url.endsWith('/auth-config'))return new Response('{"enabled":true}');
    requestSignal=options.signal;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('Aborted'),{name:'AbortError'})),{once:true}));
  }});
  await f.client.importRecords(imported);await f.client.begin();const pending=f.client.classifyNext();
  await new Promise(setImmediate);f.client.cancel();await assert.rejects(pending);
  assert.equal(requestSignal.aborted,true);assert.equal((await f.client.get()).status.pending,2);f.client.destroy();
});

test('one explicit analysis handles 100 records in bounded batches and keeps all records after reload',async()=>{
  const f=fixture();
  await f.client.importRecords({schemaVersion:1,videos:Array.from({length:100},(_,index)=>({videoId:`v${String(index).padStart(10,'0')}`,title:`Real tutorial ${index}`,channel:'Tutorial channel',pageOrder:index}))});
  let next=await f.client.begin();
  while(next.status.pending)next=await f.client.classifyNext();
  const batches=f.calls.filter(call=>call.url.endsWith('/classify')).map(call=>JSON.parse(call.options.body).videos.length);
  assert.deepEqual(batches,[12,12,12,12,12,12,12,12,4]);assert.equal(next.status.processed,100);
  await assert.rejects(f.client.importRecords(imported));assert.equal((await f.client.journal()).entries.length,100);
  f.client.destroy();const reopened=fixture({storage:f.storage});assert.equal((await reopened.client.get()).status.processed,100);reopened.client.destroy();
});
