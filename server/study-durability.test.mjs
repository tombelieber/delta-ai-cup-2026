import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStudyService} from './study/service.mjs';
import {createStudyState} from './study/state.mjs';
import {createStudyAccounts} from './study/accounts.mjs';
import {parseStudySource,StudyError} from './study/source.mjs';

const key=Buffer.alloc(32,29),project='study-durability-test';
const env={STUDY_ACCESS_MODE:'google',STUDY_ORIGIN:'https://study.example.test',GEMINI_MODEL:'gemini-3.8-flash',LEARNING_SIGNING_KEY_BASE64:key.toString('base64')};
const alice={principal:{uid:'alice'}},bob={principal:{uid:'bob'}};
const source=videoId=>parseStudySource({videoId,title:'Timing',start:0,end:60,
  text:`Video ID: ${videoId}\nCaptions: authored\n[0:00] Compare money at the same date.\n[0:20] Assume a hypothetical ten percent rate.\n[0:40] One hundred becomes one hundred ten.\n[1:00] End.`});
const sources=[source('733mgqrzNKs'),source('DiVPAjgmnj0')],input={videoId:sources[0].videoId};
const fixture=s=>({supported:true,title:'Compare dates',summary:'Use the same date.',concepts:[{label:'Timing',explanation:'Compare the dates.',anchorIds:[s.anchors[0].id]}],
  slides:[0,1,2,3].map(i=>({title:`Step ${i+1}`,body:'Assume a hypothetical rate.',bullets:['Compare dates.'],anchorId:s.anchors[0].id})),
  exercises:[0,1].map(i=>({question:`New scenario ${i+1}`,options:['110','100','90'],correctIndex:0,explanation:'100 times 1.1 is 110.',hint:'Use the rate.',anchorId:s.anchors[0].id}))});

async function setup(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'delta-study-durable-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let clock=Date.UTC(2026,9,18),generations=0,queries=0;const requests=[];
  const records=new Map(),operations=new Map(),queues=new Map();
  const store={transact(uid,operation,reduce){
    const next=(queues.get(uid)||Promise.resolve()).catch(()=>{}).then(async()=>{
      const opKey=`${uid}/${operation}`,update=await reduce(structuredClone(records.get(uid)??null),structuredClone(operations.get(opKey)??null));
      if(Object.hasOwn(update,'account'))records.set(uid,structuredClone(update.account));
      if(Object.hasOwn(update,'operation'))operations.set(opKey,structuredClone(update.operation));
      return structuredClone(update.result);
    });queues.set(uid,next);return next;
  }};
  const accounts=createStudyAccounts({env:{FIREBASE_PROJECT_ID:project,FIREBASE_WEB_CONFIG:JSON.stringify({apiKey:'public-test',authDomain:`${project}.firebaseapp.com`,projectId:project,appId:'app-test'})},store,now:()=>clock});
  const provider={async generate({source,prior,budget}){await budget.reserve(.03);generations++;requests.push({kind:'generate',prior});await budget.settle(.01,{inputTokens:100,outputTokens:100});return fixture(source);},
    async ask({memories,budget}){await budget.reserve(.01);queries++;requests.push({kind:'ask',memories});await budget.settle(.005,{inputTokens:100,outputTokens:100});return {answer:'Compare the dates.',citations:[{videoId:memories[0].videoId,anchorId:memories[0].anchorId}]};}};
  const service=(name='original',options={})=>createStudyService({directory:path.join(directory,name),sources,provider,userQuota:accounts,env,now:()=>clock,...options});
  return {directory,accounts,records,operations,provider,requests,service,advance:ms=>{clock+=ms;},now:()=>clock,calls:()=>({generations,queries})};
}

test('Google saved-source followup and numeric cost survive replacement with an empty local cache',async t=>{
  const context=await setup(t),first=context.service(),saved=await first.generate(input,alice);
  const restarted=context.service('replacement'),inspected=await restarted.inspect({lessonToken:saved.lessonToken},alice);
  assert.equal(inspected.cost.available,true);assert.equal(inspected.cost.conservativeUsd,.01);assert.deepEqual(inspected.cost.entries,[]);
  const answer=await restarted.ask({lessonToken:saved.lessonToken,question:'Why compare dates?'},alice);
  assert.equal(answer.cost.conservativeUsd,.015);assert.equal(answer.citations[0].videoId,sources[0].videoId);
  assert.deepEqual(context.calls(),{generations:1,queries:1});
});

test('missing durable sessions never appear free and block inference while owned practice and export work',async t=>{
  const context=await setup(t),saved=await context.service().generate(input,alice);
  context.records.clear();context.operations.clear();
  const restarted=context.service('replacement'),inspected=await restarted.inspect({lessonToken:saved.lessonToken},alice);
  assert.equal(inspected.cost.available,false);assert.equal(inspected.cost.conservativeUsd,null);
  await assert.rejects(restarted.ask({lessonToken:saved.lessonToken,question:'Why compare dates?'},alice),{code:'session_budget_unavailable'});
  assert.equal((await restarted.answer({lessonToken:saved.lessonToken,taskId:'exercise-1',choice:0},alice)).passed,true);
  assert.equal((await restarted.exportPptx({lessonToken:saved.lessonToken},alice)).buffer.subarray(0,2).toString(),'PK');
  assert.deepEqual(context.calls(),{generations:1,queries:0});
});

test('old owned lessons and feedback remain usable for practice, export and memory after seven days',async t=>{
  const context=await setup(t),first=context.service(),primary=await first.generate(input,alice),memory=await first.generate({videoId:sources[1].videoId},alice);
  const feedback=await first.answer({lessonToken:memory.lessonToken,taskId:'exercise-1',choice:0},alice);
  context.advance(30*86400000);
  const restarted=context.service('replacement');
  assert.equal((await restarted.inspect({lessonToken:primary.lessonToken},alice)).lesson.id,primary.lesson.id);
  assert.equal((await restarted.answer({lessonToken:primary.lessonToken,taskId:'exercise-2',choice:0},alice)).passed,true);
  assert.equal((await restarted.exportPptx({lessonToken:primary.lessonToken},alice)).buffer.subarray(0,2).toString(),'PK');
  const remembered=[{lessonToken:memory.lessonToken,feedbackTokens:[feedback.feedbackToken]}];
  await restarted.ask({lessonToken:primary.lessonToken,memory:remembered,question:'Compare dates?'},alice);
  assert.ok(context.requests.find(request=>request.kind==='ask').memories.some(item=>item.videoId===sources[1].videoId));
  const next=await restarted.generate({...input,profile:{interests:['later']},memory:remembered},alice);
  assert.equal(next.lesson.priorConcepts[0].status,'exercise-key-matched-not-mastery');
  await assert.rejects(restarted.generate({...input,memory:remembered},bob),{code:'lesson_access_denied'});
});

test('expired capabilities still reject foreign users, tampering, missing identity and default local access',async t=>{
  const context=await setup(t),first=context.service(),owned=await first.generate(input,alice);
  const local=context.service('local',{env:{...env,STUDY_ACCESS_MODE:'local'}}),anonymous=await local.generate(input);
  context.advance(8*86400000);
  const restarted=context.service('replacement');
  await assert.rejects(restarted.inspect({lessonToken:owned.lessonToken},bob),{code:'lesson_access_denied'});
  await assert.rejects(restarted.inspect({lessonToken:owned.lessonToken}),{code:'authentication_required'});
  await assert.rejects(restarted.inspect({lessonToken:anonymous.lessonToken},alice),{code:'lesson_access_denied'});
  await assert.rejects(local.inspect({lessonToken:anonymous.lessonToken}),{code:'expired_lesson'});
  const state=createStudyState({directory:context.directory,key,now:context.now});
  assert.throws(()=>state.open(owned.lessonToken),{code:'expired_lesson'});
  const tampered=owned.lessonToken.slice(0,10)+(owned.lessonToken[10]==='A'?'B':'A')+owned.lessonToken.slice(11);
  await assert.rejects(restarted.inspect({lessonToken:tampered},alice),{code:'invalid_lesson_token'});
});

test('a proven local reservation-write failure refunds durable credit before any provider dispatch',async t=>{
  const context=await setup(t),base=context.accounts;let dispatched=0;
  const cache=path.join(context.directory,'blocked');
  const accounts={forUser(uid){const account=base.forUser(uid);return {...account,async reserve(value){
    const reserved=await account.reserve(value);await mkdir(path.join(cache,`${value.sessionId}.cost.json`));return reserved;
  }};}};
  const service=context.service('blocked',{userQuota:accounts,provider:{async generate({budget}){await budget.reserve(.03);dispatched++;return fixture(sources[0]);}}});
  await assert.rejects(service.generate(input,alice),error=>['EISDIR','ENOTDIR','EEXIST'].includes(error.code));
  assert.equal(dispatched,0);
  assert.deepEqual(await base.forUser('alice').snapshot(),{limitUsd:.5,reservedUsd:0,spentUsd:0,remainingUsd:.5});
  assert.equal([...context.operations.values()][0].actualMicros,0);
});

test('unknown failures after dispatch retain their durable reservation',async t=>{
  const context=await setup(t);let dispatched=0;
  const service=context.service('failed',{provider:{async generate({budget}){await budget.reserve(.03);dispatched++;await budget.failure({step:'generateContent',httpStatus:503});throw new StudyError('provider_temporarily_unavailable',503);}}});
  await assert.rejects(service.generate(input,alice),{code:'provider_temporarily_unavailable'});
  assert.equal(dispatched,1);assert.equal((await context.accounts.forUser('alice').snapshot()).reservedUsd,.03);
});

test('stale local totals cannot deny an affordable Google operation and actual overruns still stop it',async t=>{
  const context=await setup(t),service=context.service(),saved=await service.generate(input,alice);
  const cache=path.join(context.directory,'original'),costFile=(await readdir(cache)).find(name=>name.endsWith('.cost.json'));
  const receipt=JSON.parse(await readFile(path.join(cache,costFile),'utf8'));receipt.conservativeUsd=.099;
  await writeFile(path.join(cache,costFile),JSON.stringify(receipt));
  assert.equal((await service.ask({lessonToken:saved.lessonToken,question:'Compare dates?'},alice)).cost.conservativeUsd,.015);
  const overrun=context.service('overrun',{provider:{async generate({budget}){await budget.reserve(.03);await budget.settle(.11,{inputTokens:1,outputTokens:1});return fixture(sources[0]);}}});
  await assert.rejects(overrun.generate({...input,profile:{interests:['overrun']}},alice),{code:'video_budget_exceeded'});
});
