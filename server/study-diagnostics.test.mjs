import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sanitizeStudyDiagnostics} from './study/diagnostics.mjs';
import {createStudyService} from './study/service.mjs';
import {parseStudySource,StudyError} from './study/source.mjs';
import {createServer} from './index.mjs';
import {createStudyRouter} from './study/router.mjs';
import {createStudyClassificationService} from './study/classification.mjs';
import {createStudyAccounts,createFirestoreStudyAccountStore} from './study/accounts.mjs';
import {createStudyProvider} from './study/provider.mjs';
import {STUDY_PROJECT_BUDGET_PATH} from './study/project-budget.mjs';

const privateValue='private-key-user@example.test';
const contractDiagnostic={step:'lesson_contract',kind:'format',path:'slides[0].body',reason:'string_too_long',retryable:true,length:551,maximum:550};
test('diagnostics retain only fixed machine fields and bounded numbers',()=>{
  const raw={...contractDiagnostic,body:privateValue,uid:privateValue,email:privateValue,token:privateValue,message:privateValue,
    stack:privateValue,unknown:privateValue,httpStatus:503,providerStatus:'UNAVAILABLE',finishReason:'MAX_TOKENS',transient:true,usageKnown:true,
    minimum:-1,count:Infinity};
  assert.deepEqual(sanitizeStudyDiagnostics(raw),{...contractDiagnostic,httpStatus:503,providerStatus:'UNAVAILABLE',finishReason:'MAX_TOKENS',transient:true,usageKnown:true});
  assert.ok(!JSON.stringify(sanitizeStudyDiagnostics(raw)).includes(privateValue));
  assert.deepEqual(sanitizeStudyDiagnostics({step:privateValue,path:`slides[0].${privateValue}`,reason:privateValue,kind:privateValue,
    phase:privateValue,providerStatus:privateValue,finishReason:privateValue,retryable:'true',length:1e12,httpStatus:999}),{});
  for(const value of [null,[],privateValue,42])assert.deepEqual(sanitizeStudyDiagnostics(value),{});
});

test('path grammar excludes unknown properties, data IDs, trailing whitespace and accessors',()=>{
  for(const value of ['slides[0].body\n','concepts[0].raw','citations[0].733mgqrzNKs','source.__proto__','slides[999999].body']){
    assert.equal(sanitizeStudyDiagnostics({path:value}).path,undefined,value);
  }
  let invoked=false;
  const input=Object.create({reason:'string_too_long'});
  Object.defineProperty(input,'path',{get(){invoked=true;throw Error(privateValue);}});
  assert.deepEqual(sanitizeStudyDiagnostics(input),{});assert.equal(invoked,false);
  assert.equal(sanitizeStudyDiagnostics({path:'slides[0].title'}).path,'slides[0].title');
  assert.deepEqual(sanitizeStudyDiagnostics({step:'generateContent',phase:'json',reason:'invalid_output_json',kind:'format',usageKnown:false}),
    {step:'generateContent',phase:'json',reason:'invalid_output_json',kind:'format',usageKnown:false});
});

const source=parseStudySource({videoId:'733mgqrzNKs',title:'Timing',start:0,end:60,
  text:'Video ID: 733mgqrzNKs\nCaptions: authored\n[0:00] Compare money at the same date.\n[0:20] Assume a hypothetical ten percent rate.\n[0:40] One hundred becomes one hundred ten.\n[1:00] End.'});
function invalidLesson(){return {supported:true,title:'Timing',summary:' ',concepts:[],slides:[],exercises:[]};}
async function setupService(t,{breakReceipt=false,providerFailure,rawLesson}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'delta-study-diagnostics-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let calls=0,failureDiagnostic;
  const service=createStudyService({directory,sources:[source],env:{LEARNING_SIGNING_KEY:'diagnostic-test',GEMINI_MODEL:'gemini-3.8-flash'},
    provider:{async generate({budget}){calls++;await budget.reserve(.04);await budget.settle(.012,{inputTokens:100,outputTokens:100});
      if(providerFailure)throw providerFailure;
      if(breakReceipt)budget.failure=async value=>{failureDiagnostic=value;throw Error(privateValue);};
      return rawLesson??invalidLesson();}}});
  return {service,directory,calls:()=>calls,diagnostic:()=>failureDiagnostic};
}

test('invalid contract records diagnostics after settlement without synthetic lesson or retry',async t=>{
  const {service,directory,calls}=await setupService(t);
  await assert.rejects(service.generate({videoId:source.videoId}),error=>error.code==='invalid_provider_output'&&error.diagnostics?.step==='lesson_contract');
  const files=await readdir(directory);assert.equal(files.some(file=>file.endsWith('.lesson.json')),false);
  const cost=JSON.parse(await readFile(path.join(directory,files.find(file=>file.endsWith('.cost.json'))),'utf8'));
  assert.equal(cost.conservativeUsd,.012);assert.equal(cost.entries[0].actualUsd,.012);
  assert.equal(cost.entries[0].failure.step,'lesson_contract');assert.equal(calls(),1);
});

test('failed diagnostic persistence preserves original contract error and known cost',async t=>{
  const original=Object.assign(new StudyError('invalid_provider_output',502),{diagnostics:contractDiagnostic});
  const rawLesson=Object.defineProperty({},'supported',{get(){throw original;}});
  const {service,directory,calls,diagnostic}=await setupService(t,{breakReceipt:true,rawLesson});
  await assert.rejects(service.generate({videoId:source.videoId}),error=>error===original);
  assert.equal(diagnostic().step,'lesson_contract');assert.equal(calls(),1);
  const file=(await readdir(directory)).find(file=>file.endsWith('.cost.json'));
  assert.equal(JSON.parse(await readFile(path.join(directory,file),'utf8')).conservativeUsd,.012);
});

test('provider failures are not intercepted or retried by the contract recording catch',async t=>{
  const failure=Object.assign(new StudyError('provider_temporarily_unavailable',503),{diagnostics:{step:'generateContent',httpStatus:503,transient:true}});
  const {service,calls}=await setupService(t,{providerFailure:failure});
  await assert.rejects(service.generate({videoId:source.videoId}),error=>error===failure);assert.equal(calls(),1);
});

async function requestServer(t,{failure,onDiagnostic}={}){
  const studyService={access:{mode:'local',check:()=>null},generate:async()=>{throw failure;}};
  const server=createServer({studyService,...(onDiagnostic?{onDiagnostic}:{})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return new Promise((resolve,reject)=>{
    const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/study/generate',method:'POST',headers:{'content-type':'application/json'}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));
    });request.on('error',reject);request.end('{}');
  });
}

test('real HTTP entry emits sanitized structured logs with the same public failure reference',async t=>{
  const logs=[];t.mock.method(console,'error',line=>logs.push(JSON.parse(line)));
  const failure=Object.assign(new StudyError('invalid_provider_output',502,privateValue),{diagnostics:{...contractDiagnostic,body:privateValue}});
  const result=await requestServer(t,{failure});
  assert.equal(result.status,502);assert.equal(result.body.error,'invalid_provider_output');
  assert.match(result.body.reference,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(logs.length,1);assert.equal(logs[0].reference,result.body.reference);
  assert.equal(logs[0].diagnostics.path,'slides[0].body');assert.equal(logs[0].action,'generate');
  assert.equal(result.body.diagnostics,undefined);assert.ok(!JSON.stringify({logs,result}).includes(privateValue));
  assert.match(result.body.message,/saved/i);
});

test('unknown SDK failures and failing diagnostic hooks cannot disclose or mask errors',async t=>{
  const failure=Object.assign(Error(privateValue),{code:privateValue,diagnostics:{step:privateValue,raw:privateValue}});
  const events=[];
  const result=await requestServer(t,{failure,onDiagnostic:async event=>{events.push(event);throw Error(privateValue);}});
  assert.equal(result.status,503);assert.equal(result.body.error,'study_unavailable');assert.equal(events.length,1);
  assert.ok(!JSON.stringify({events,result}).includes(privateValue));
});

test('unknown backend StudyError codes are generic and authentication denial stays unchanged',async t=>{
  const events=[];
  const result=await requestServer(t,{failure:new StudyError(privateValue,503,privateValue),onDiagnostic:event=>events.push(event)});
  assert.equal(result.body.error,'study_unavailable');assert.ok(!JSON.stringify({events,result}).includes(privateValue));
  let output,diagnostics=0;
  const router=createStudyRouter({access:{mode:'google',check:()=>null}},{
    accounts:{config:()=>({enabled:true}),forUser(){throw Error('must not read');},authenticate:async()=>{throw new StudyError('authentication_required',401,'Sign in.');}},
    onDiagnostic(){diagnostics++;}});
  await router({request:{method:'POST',headers:{}},url:new URL('https://test/api/study/generate'),response:{},rateAllowed:()=>true,
    readBody(){throw Error('must not read');},json(status,body){output={status,body};}});
  assert.deepEqual(output,{status:401,body:{error:'authentication_required',message:'Sign in.'}});assert.equal(diagnostics,0);
});

async function classifyThroughRouter(classificationService,input){
  let result;const events=[];
  const router=createStudyRouter({access:{mode:'google',check:()=>null}},{classificationService,
    entitlements:{forUser:()=>({assertRegistered:async()=>{}})},
    accounts:{config:()=>({enabled:true}),authenticate:async()=>({uid:privateValue}),forUser(){throw Error('unused');}},
    onDiagnostic:event=>events.push(event)});
  await router({request:{method:'POST',headers:{'content-type':'application/json'}},url:new URL('https://test/api/study/classify'),response:{},rateAllowed:()=>true,
    readBody:async()=>JSON.stringify(input),json(status,body){result={status,body};}});
  return {result,events};
}

test('real classification capacity rejection retains its 429 code and safe reference',async()=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const classificationService=createStudyClassificationService({env:{GEMINI_MODEL:'gemini-3.8-flash'},
    accounts:{forUser:()=>({check:async()=>{}})},provider:{classifyMetadata:()=>pending}});
  const active=Array.from({length:32},(_,index)=>classificationService.classify(
    {videos:[{videoId:source.videoId,title:`Public tutorial ${index}`}]},{principal:{uid:'capacity-fixture'}}));
  try{
    const {result,events}=await classifyThroughRouter(classificationService,{videos:[{videoId:source.videoId,title:privateValue}]});
    assert.equal(result.status,429);assert.equal(result.body.error,'classification_busy');
    assert.match(result.body.reference,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    assert.equal(events.length,1);assert.equal(events[0].code,'classification_busy');assert.equal(events[0].reference,result.body.reference);
    assert.equal(result.body.diagnostics,undefined);assert.ok(!JSON.stringify({result,events}).includes(privateValue));
  }finally{release([]);await Promise.all(active);}
});

test('actual classification input normalization retains its typed 400 rejection',async()=>{
  const classificationService=createStudyClassificationService({env:{GEMINI_MODEL:'gemini-3.8-flash'},
    accounts:{forUser(){throw Error('must not access credit');}},provider:{classifyMetadata(){throw Error('must not generate');}}});
  const {result,events}=await classifyThroughRouter(classificationService,{videos:[]});
  assert.equal(result.status,400);assert.equal(result.body.error,'invalid_classification_input');
  assert.equal(events[0].code,'invalid_classification_input');assert.equal(events[0].reference,result.body.reference);
  assert.equal(result.body.diagnostics,undefined);assert.ok(!JSON.stringify({result,events}).includes(privateValue));
});

test('actual shared project exhaustion retains router 429, its safe code and UUID without inference',async()=>{
  const saved={schemaVersion:1,limitMicros:10000000,reservedMicros:0,spentMicros:10000000};
  const records=new Map([[STUDY_PROJECT_BUDGET_PATH,saved]]),calls=[];
  const reference=name=>({path:name,collection:collection=>({doc:id=>reference(`${name}/${collection}/${id}`)})});
  const firestore={collection:name=>({doc:id=>reference(`${name}/${id}`)}),async runTransaction(run){
    const writes=[];
    const result=await run({get:async ref=>({exists:records.has(ref.path),data:()=>structuredClone(records.get(ref.path))}),
      set:(ref,value)=>writes.push([ref.path,structuredClone(value)])});
    for(const [name,value] of writes)records.set(name,value);
    return result;
  }};
  const env={AI_PROVIDER:'gemini',GEMINI_MODEL:'gemini-3.8-flash',GEMINI_API_KEY:'synthetic-key',
    FIREBASE_PROJECT_ID:'study-diagnostics-test-project',
    STUDY_ACCESS_MODE:'google',GEMINI_PAID_BUDGET_APPROVED:'true',STUDY_PROJECT_BUDGET_USD:'10'};
  const accounts=createStudyAccounts({env,store:createFirestoreStudyAccountStore(firestore,{env})});
  const provider=createStudyProvider({env,fetchImpl:async url=>{
    if(url.endsWith(':countTokens')){calls.push('count');return new Response('{"totalTokens":1000}');}
    calls.push('generate');throw Error('must not dispatch inference');
  }});
  const classificationService=createStudyClassificationService({env,accounts,provider});
  const {result,events}=await classifyThroughRouter(classificationService,{videos:[{videoId:source.videoId,title:privateValue}]});
  assert.equal(result.status,429);assert.equal(result.body.error,'project_budget_exhausted');
  assert.match(result.body.reference,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(events.length,1);assert.equal(events[0].code,'project_budget_exhausted');
  assert.equal(events[0].status,429);assert.equal(events[0].reference,result.body.reference);
  assert.equal(result.body.diagnostics,undefined);assert.ok(!JSON.stringify({result,events}).includes(privateValue));
  assert.deepEqual(calls,['count']);assert.deepEqual([...records],[[STUDY_PROJECT_BUDGET_PATH,saved]]);
});
