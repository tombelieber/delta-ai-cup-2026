import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudyClient,restoreStudySelection,studySourceFromSearch,validateStudyInitialSource} from '../src/learning/study-client.mjs';
const fixture={lesson:{id:'lesson-a',source:{videoId:'733mgqrzNKs'},slides:[],exercises:[{id:'exercise-1'},{id:'exercise-2'}],concepts:[]},lessonToken:'opaque-token',cost:{conservativeUsd:.02}};
function storage(){let value=null;return {async get(){return structuredClone(value);},async set(next){value=structuredClone(next);}};}
test('local study saves authentic API results and feedback survives client recreation',async()=>{
  const local=storage(),client=createStudyClient({storage:local,fetchImpl:async()=>new Response(JSON.stringify(fixture),{status:200})});
  await client.generate({videoId:'733mgqrzNKs'});
  await client.saveAttempt({lessonId:'lesson-a',taskId:'exercise-1',choice:0,passed:true,method:'ai-authored-key-match',feedbackToken:'opaque-attempt'});
  const reopened=createStudyClient({storage:local});const library=await reopened.library();
  assert.equal(library.items[0].attempts[0].passed,true);assert.equal(library.items[0].lessonToken,'opaque-token');
});
test('quota failure preserves local results and does not automatically retry',async()=>{
  const local=storage(),first=createStudyClient({storage:local,fetchImpl:async()=>new Response(JSON.stringify(fixture),{status:200})});await first.generate({});
  let calls=0;const paused=createStudyClient({storage:local,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:'free_tier_quota_exhausted',message:'Quota paused'}),{status:429});}});
  await assert.rejects(paused.generate({}),/Quota paused/);assert.equal(calls,1);assert.equal((await paused.library()).items.length,1);
});
test('foreign feedback and malformed results cannot overwrite local learning',async()=>{
  const client=createStudyClient({storage:storage(),fetchImpl:async()=>new Response('{}',{status:200})});
  await assert.rejects(client.generate({}),/incomplete/);
  await assert.rejects(client.saveAttempt({lessonId:'unknown',taskId:'exercise-1'}),/match/);
  assert.equal((await client.library()).items.length,0);
});
test('restoring local learning keeps the selected source aligned with its displayed lesson',()=>{
  const items=[fixture,{lesson:{id:'lesson-b',source:{videoId:'DiVPAjgmnj0'}}}];
  assert.equal(restoreStudySelection(items).activeId,'lesson-b');
  assert.equal(restoreStudySelection(items).videoId,'DiVPAjgmnj0');
  assert.equal(restoreStudySelection(items,'733mgqrzNKs').activeId,'lesson-a');
  assert.equal(restoreStudySelection(items,'rXVR-nE2jvw').activeId,'');
  assert.equal(restoreStudySelection(items,'rXVR-nE2jvw').videoId,'rXVR-nE2jvw');
});
test('reopening a saved lesson restores the learner context used to generate it',()=>{
  const profile={level:'some-experience',language:'en',interests:['small shop','cash planning']};
  const restored=restoreStudySelection([{...fixture,lesson:{...fixture.lesson,profile}}]);
  assert.deepEqual(restored.profile,profile);
  assert.equal(restored.interest,'small shop, cash planning');
  const fresh=restoreStudySelection([],'DiVPAjgmnj0');
  assert.deepEqual(fresh.profile,{level:'beginner',language:'en',interests:[]});
  assert.equal(fresh.interest,'');
});
test('a source URL restores only its matching saved lesson',()=>{
  const items=[fixture,{lesson:{id:'lesson-b',source:{videoId:'DiVPAjgmnj0'}}}];
  for(const source of [{url:'https://www.youtube.com/watch?v=733mgqrzNKs'},{videoUrl:'https://youtu.be/733mgqrzNKs?t=20'}]){
    const restored=restoreStudySelection(items,source);
    assert.equal(restored.activeId,'lesson-a');assert.equal(restored.videoId,'733mgqrzNKs');
  }
});
test('prepared PowerPoint links retain their bounded expiry and reject invalid tickets',async()=>{
  const ticket={url:'/api/study/download/12345678-1234-1234-1234-123456789abc',filename:'Delta.pptx',expiresInSeconds:90};
  const client=createStudyClient({endpoint:'http://127.0.0.1:8787',storage:storage(),fetchImpl:async()=>new Response(JSON.stringify(ticket),{status:200})});
  const before=Date.now(),download=await client.preparePptx({lessonToken:'opaque-token'}),after=Date.now();
  assert.equal(download.href,'http://127.0.0.1:8787/api/study/download/12345678-1234-1234-1234-123456789abc');
  assert.equal(download.name,'Delta.pptx');
  assert.ok(download.expiresAt>=before+90000&&download.expiresAt<=after+90000);
  ticket.expiresInSeconds=0;await assert.rejects(client.preparePptx({}),/incomplete/);
});
test('authenticated study resolves a fresh Firebase token before each protected request',async()=>{
  const requests=[];let token='firebase-id-token-one';
  const client=createStudyClient({userId:'user-a',storage:storage(),getToken:async()=>token,fetchImpl:async(url,init)=>{requests.push({url,authorization:new Headers(init.headers).get('authorization')});return new Response(JSON.stringify({sources:[]}),{status:200});}});
  await client.catalogue();token='firebase-id-token-two';await client.session();
  assert.deepEqual(requests,[{url:'/api/study/catalogue',authorization:'Bearer firebase-id-token-one'},{url:'/api/study/session',authorization:'Bearer firebase-id-token-two'}]);
  assert.throws(()=>createStudyClient({getToken:async()=>token}),/user/i);
});
test('authenticated libraries are isolated by endpoint and user while local storage remains compatible',async t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),entries=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value)}});
  t.after(()=>previous?Object.defineProperty(globalThis,'localStorage',previous):delete globalThis.localStorage);
  const input={fetchImpl:async()=>new Response(JSON.stringify(fixture),{status:200})};
  const local=createStudyClient(input);await local.generate({});
  const alice=createStudyClient({...input,endpoint:'https://delta.example',userId:'alice',getToken:async()=>'alice-id-token'});await alice.generate({});
  const bob=createStudyClient({...input,endpoint:'https://delta.example',userId:'bob',getToken:async()=>'bob-id-token'});
  const elsewhere=createStudyClient({...input,endpoint:'https://other.example',userId:'alice',getToken:async()=>'alice-id-token'});
  assert.equal((await bob.library()).items.length,0);assert.equal((await elsewhere.library()).items.length,0);
  assert.equal((await alice.library()).items.length,1);assert.equal((await local.library()).items.length,1);
  assert.ok([...entries.values()].every(value=>!value.includes('alice-id-token')&&!value.includes('bob-id-token')));
});
test('authenticated PowerPoint downloads fetch with a fresh bearer token and expose only a local Blob link',async()=>{
  const requests=[];let tokens=0;
  const client=createStudyClient({userId:'alice',storage:storage(),getToken:async()=>`firebase-id-${++tokens}`,fetchImpl:async(url,init)=>{
    requests.push({url,authorization:new Headers(init.headers).get('authorization')});
    return url.endsWith('/preparePptx')?new Response(JSON.stringify({url:'/api/study/download/12345678-1234-4234-8234-123456789abc',filename:'Delta.pptx',expiresInSeconds:90}),{status:200}):new Response('powerpoint-bytes',{status:200,headers:{'content-type':'application/vnd.openxmlformats-officedocument.presentationml.presentation'}});
  }});
  const download=await client.preparePptx({lessonToken:'opaque-token'});
  try{
    assert.match(download.href,/^blob:/);assert.equal(download.expiresAt,undefined);
    assert.equal(await (await fetch(download.href)).text(),'powerpoint-bytes');
    assert.deepEqual(requests,[{url:'/api/study/preparePptx',authorization:'Bearer firebase-id-1'},{url:'/api/study/download/12345678-1234-4234-8234-123456789abc',authorization:'Bearer firebase-id-2'}]);
  }finally{URL.revokeObjectURL(download.href);}
});
test('validated website video selection preserves unsupported YouTube identity instead of selecting Finance',()=>{
  const source=studySourceFromSearch('?study=1&videoId=abcdefghijk');
  assert.deepEqual(source,{videoId:'abcdefghijk',url:'https://www.youtube.com/watch?v=abcdefghijk'});
  const restored=restoreStudySelection([fixture],source);
  assert.equal(restored.videoId,'abcdefghijk');assert.equal(restored.activeId,'');
  assert.throws(()=>studySourceFromSearch('?videoId=https://attacker.invalid'),/video/i);
  assert.equal(studySourceFromSearch('?study=1'),null);
});
test('captured lesson input keeps the selected clip and rejects mismatched or oversized captions',()=>{
  const source={videoId:'abcdefghijk',title:'Current teaching video',url:'https://www.youtube.com/watch?v=abcdefghijk'},transcript='Video ID: abcdefghijk\nCaptions: automatic\n[01:00] One\n[01:10] Two\n[01:20] Three';
  assert.deepEqual(validateStudyInitialSource({...source,start:60,end:90,transcript},source),{...source,text:transcript,start:60,end:90});
  assert.throws(()=>validateStudyInitialSource({...source,start:60,end:90,transcript:transcript.replace('abcdefghijk','733mgqrzNKs')},source),/match/i);
  assert.throws(()=>validateStudyInitialSource({...source,url:'https://www.youtube.com/watch?v=733mgqrzNKs',start:60,end:90,transcript},source),/match/i);
  assert.throws(()=>validateStudyInitialSource({...source,start:60,end:361,transcript},source),/clip/i);
  assert.throws(()=>validateStudyInitialSource({...source,start:60,end:90,transcript:`Video ID: abcdefghijk\n${'字'.repeat(90000)}`},source),/250 KB/i);
});

test('import requests use the verified account token and validate bound receipts',async()=>{
  const input={operationId:'preview-1',videoIds:['733mgqrzNKs']},receipt={...input,added:1,imports:{limit:10,used:1,remaining:9}},calls=[];
  const client=createStudyClient({userId:'alice',getToken:async()=>'test-token',fetchImpl:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(receipt));}});
  assert.deepEqual(await client.registerImports(input),receipt);assert.equal(calls[0].url,'/api/study/registerImports');assert.equal(calls[0].init.headers.Authorization,'Bearer test-token');
  const broken=createStudyClient({fetchImpl:async()=>new Response(JSON.stringify({...receipt,videoIds:['abcdefghijk']}))});await assert.rejects(broken.registerImports(input),/could not be verified/);
});
