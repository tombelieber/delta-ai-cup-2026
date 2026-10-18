import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudyRouter} from './study/router.mjs';
import {StudyError} from './study/source.mjs';

const ticket='12345678-1234-4234-8234-123456789abc';
function setup({admission,now,classificationService,mode='google',rateAllowed=()=>true,snapshot=async()=>({remainingUsd:.5}),catalogue=async()=>({sources:[]})}={}){
  const calls={auth:0,store:0,body:0,download:0,work:0,rate:0};
  const accounts={config:()=>({enabled:true}),async authenticate(request){calls.auth++;const uid=request.headers.authorization;
    if(!uid)throw new StudyError('authentication_required',401);return {uid};},
  forUser:uid=>({async snapshot(){calls.store++;return snapshot(uid);}})};
  const service={access:{mode,check:()=>null},catalogue,
    async downloadPptx(id,{principal}){calls.download++;return {buffer:Buffer.from('PK'),filename:`${principal.uid}.pptx`,contentType:'application/test'};},
    async inspect(){calls.work++;return {saved:true};},async ask(){calls.work++;return {answer:'Saved answer.'};}};
  const router=createStudyRouter(service,{accounts,classificationService,admission,now});
  async function request(action='session',{method='GET',uid='alice',type='application/json'}={}){
    const result={};
    await router({request:{method,headers:{authorization:uid,'content-type':type}},url:new URL(`https://study.test/api/study/${action}`),
      response:{writeHead(status,headers){Object.assign(result,{status,headers});},end(buffer){result.buffer=buffer;}},
      json(status,body,headers){Object.assign(result,{status,body,headers});},
      readBody:async()=>{calls.body++;return '{}';},rateAllowed:request=>{calls.rate++;return rateAllowed(request);}});
    return result;
  }
  return {request,calls};
}

test('session floods stop at cheap admission before repeated Auth and Firestore calls',async()=>{
  let available=10;
  const {request,calls}=setup({rateAllowed:()=>available-->0});
  const results=[];for(let i=0;i<45;i++)results.push(await request());
  assert.equal(results.filter(result=>result.status===200).length,10);
  assert.equal(results.filter(result=>result.status===429).length,35);
  assert.equal(calls.auth,10);assert.equal(calls.store,10);assert.equal(calls.rate,45);
});

test('every protected GET and POST action is admitted before authentication or work',async()=>{
  const {request,calls}=setup({rateAllowed:()=>false});
  for(const action of ['session','catalogue',`download/${ticket}`])assert.equal((await request(action)).status,429);
  for(const action of ['generate','answer','ask','pptx','preparePptx','inspect','classify'])assert.equal((await request(action,{method:'POST'})).status,429);
  assert.deepEqual(calls,{auth:0,store:0,body:0,download:0,work:0,rate:10});
});

test('unknown paths never authenticate; public configuration stays cheap',async()=>{
  const {request,calls}=setup({rateAllowed:()=>false});
  for(const action of ['missing','download/not-a-ticket','auth-config/extra'])assert.equal((await request(action)).status,404);
  assert.equal((await request('auth-config',{uid:undefined})).status,200);
  assert.deepEqual(calls,{auth:0,store:0,body:0,download:0,work:0,rate:0});
});

test('wrong methods preserve authentication before returning a method error without work',async()=>{
  const {request,calls}=setup();
  assert.equal((await request('generate',{uid:null})).status,401);
  assert.equal((await request('generate')).status,405);
  assert.equal(calls.body,0);assert.equal(calls.store,0);assert.equal(calls.work,0);
});

test('verified UID rate limits isolate accounts and reject before account reads',async()=>{
  const {request,calls}=setup({admission:{requestsPerMinute:2}});
  assert.equal((await request()).status,200);assert.equal((await request()).status,200);
  assert.equal((await request()).status,429);assert.equal(calls.store,2);
  assert.equal((await request('session',{uid:'bob'})).status,200);assert.equal(calls.store,3);
});

test('UID concurrency rejects busy users without blocking another account and releases on success',async()=>{
  let unblock,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const pending=new Promise(resolve=>{unblock=resolve;});
  let first=true;
  const {request,calls}=setup({admission:{maxConcurrent:1},snapshot:async uid=>{if(uid==='alice'&&first){first=false;started();await pending;}return {remainingUsd:.5};}});
  const inFlight=request();await ready;
  const busy=await request();assert.equal(busy.status,429);assert.equal(busy.body.error,'study_user_busy');
  assert.equal(calls.store,1);
  assert.equal((await request('session',{uid:'bob'})).status,200);
  unblock();assert.equal((await inFlight).status,200);assert.equal((await request()).status,200);
});

test('UID concurrency is released after ledger errors and ordinary protected downloads',async()=>{
  let fail=true;
  const {request,calls}=setup({admission:{maxConcurrent:1},snapshot:async()=>{if(fail){fail=false;throw Error('offline');}return {remainingUsd:.5};}});
  assert.equal((await request()).status,503);assert.equal((await request()).status,200);
  const download=await request(`download/${ticket}`);
  assert.equal(download.status,200);assert.equal(download.buffer.toString(),'PK');
  assert.equal(calls.download,1);assert.equal((await request('inspect',{method:'POST'})).status,200);
});

test('UID admission precedes POST body/provider work and releases unexpected async failures',async()=>{
  const limited=setup({admission:{requestsPerMinute:1}});
  assert.equal((await limited.request()).status,200);
  assert.equal((await limited.request('ask',{method:'POST'})).status,429);
  assert.equal(limited.calls.body,0);assert.equal(limited.calls.work,0);
  let fail=true;
  const {request}=setup({admission:{maxConcurrent:1},catalogue:async()=>{if(fail){fail=false;throw Error('offline');}return {sources:[]};}});
  assert.equal((await request('catalogue')).status,503);
  assert.equal((await request('catalogue')).status,200);
});

test('UID map fails closed at capacity and evicts expired inactive windows',async()=>{
  let time=0;
  const {request,calls}=setup({now:()=>time,admission:{maxUsers:2}});
  assert.equal((await request()).status,200);assert.equal((await request('session',{uid:'bob'})).status,200);
  const full=await request('session',{uid:'carol'});assert.equal(full.status,429);assert.equal(calls.store,2);
  time=60000;
  assert.equal((await request('session',{uid:'carol'})).status,200);assert.equal(calls.store,3);
});

test('expired active UID entries cannot be evicted to bypass concurrency',async()=>{
  let time=0,unblock,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const pending=new Promise(resolve=>{unblock=resolve;});
  const {request,calls}=setup({now:()=>time,admission:{maxUsers:1,maxConcurrent:1},snapshot:async()=>{started();await pending;return {remainingUsd:.5};}});
  const inFlight=request();await ready;time=60000;
  assert.equal((await request('session',{uid:'bob'})).status,429);assert.equal(calls.store,1);
  assert.equal((await request()).body.error,'study_user_busy');
  unblock();await inFlight;
  assert.equal((await request('session',{uid:'bob'})).status,200);
});

test('classification requires authentication and forwards only the verified principal',async()=>{
  const invoked=[];
  const {request,calls}=setup({classificationService:{async classify(input,context){invoked.push({input,context});return {items:[]};}}});
  assert.equal((await request('classify',{method:'POST',uid:null})).status,401);
  assert.equal(calls.body,0);assert.equal(invoked.length,0);
  const result=await request('classify',{method:'POST'});
  assert.equal(result.status,200);assert.deepEqual(result.body,{items:[]});
  assert.deepEqual(invoked,[{input:{},context:{principal:{uid:'alice'}}}]);
});

test('classification fails closed without its metered service or a verified principal',async()=>{
  const missing=setup();
  const unavailable=await missing.request('classify',{method:'POST'});
  assert.equal(unavailable.status,503);assert.equal(unavailable.body.error,'classification_unavailable');
  let invoked=false;
  const local=setup({mode:'local',classificationService:{classify(){invoked=true;}}});
  assert.equal((await local.request('classify',{method:'POST'})).status,401);
  assert.equal(invoked,false);
});
