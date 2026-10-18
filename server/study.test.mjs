import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStudyService} from './study/service.mjs';
import {createStudyProvider} from './study/provider.mjs';
import {parseStudySource} from './study/source.mjs';
import {createStudyState} from './study/state.mjs';

const source={videoId:'733mgqrzNKs',title:'Time value of money',start:0,end:60,
  text:'Video ID: 733mgqrzNKs\nCaptions: authored\n[0:00] Timing matters for money.\n[0:20] A hypothetical ten percent rate makes 100 become 110.\n[0:40] Compare alternatives on the same date.\n[1:00] End.'};
const fixture=s=>({supported:true,title:'Compare timing',summary:'Use the same date.',concepts:[{label:'Time value',explanation:'Money today can earn interest.',anchorIds:[s.anchors[0].id]}],
  slides:[0,1,2,3].map(i=>({title:`Step ${i+1}`,body:'Assume a hypothetical rate.',bullets:['Compare the dates.'],anchorId:s.anchors[0].id})),
  exercises:[0,1].map(i=>({question:`New scenario ${i+1}`,options:['110','100','90'],correctIndex:0,explanation:'100 times 1.1 is 110.',hint:'Use the stated rate.',anchorId:s.anchors[0].id}))});
const input={videoId:source.videoId,profile:{level:'beginner',language:'en',interests:[]}};
const env={LEARNING_SIGNING_KEY:'test-study-signing',GEMINI_MODEL:'gemini-3.8-flash'};
async function setup(t,provider){ const directory=await mkdtemp(path.join(os.tmpdir(),'delta-study-'));t.after(()=>rm(directory,{recursive:true,force:true}));return {directory,service:createStudyService({directory,sources:[parseStudySource(source)],env,provider:provider||{async generate({source,budget}){await budget.reserve(.04);await budget.settle(.012,{inputTokens:2000,outputTokens:1200});return fixture(source);},async ask(){return {answer:'Timing matters.',citations:[{videoId:source.videoId,anchorId:`${source.videoId}-0`}]};}}})}; }
test('encrypted saved lessons survive restart and reject invalid capabilities',async t=>{
  const {service,directory}=await setup(t);
  const generated=await service.generate(input);
  assert.equal(generated.lesson.exercises[0].correctIndex,undefined);
  assert.equal(generated.lesson.source.anchors[0].text,undefined);
  await assert.rejects(service.inspect({lessonToken:'not-a-capability'}),/invalid_lesson_token/);
  const restarted=createStudyService({directory,sources:[parseStudySource(source)],env,provider:{generate(){throw Error('Cache miss');}}});
  assert.equal((await restarted.generate(input)).cached,true);
  assert.equal((await restarted.inspect({lessonToken:generated.lessonToken})).lesson.id,generated.lesson.id);
});
test('practice checks bind to an authentic lesson and support wrong, correct and next exercise attempts',async t=>{
  const {service}=await setup(t),{lesson,lessonToken}=await service.generate(input);
  await assert.rejects(service.answer({lessonToken,taskId:'foreign-task',choice:0}),/invalid_task_id/);
  const wrong=await service.answer({lessonToken,taskId:'exercise-1',choice:1});
  assert.equal(wrong.passed,false);assert.ok(wrong.hint);
  assert.equal((await service.answer({lessonToken,taskId:'exercise-1',choice:0})).passed,true);
  assert.equal((await service.answer({lessonToken,taskId:'exercise-2',choice:0})).passed,true);
  assert.equal(wrong.lessonId,lesson.id);assert.ok(wrong.feedbackToken);assert.equal(wrong.mastery,undefined);
});
test('a whole video budget is enforced before any unaffordable second operation',async t=>{
  const {service}=await setup(t,{async generate({source,budget}){await budget.reserve(.08);await budget.settle(.08,{inputTokens:1,outputTokens:1});return fixture(source);},async ask({budget}){await budget.reserve(.03);throw Error('must not dispatch');}});
  const {lessonToken}=await service.generate(input);
  await assert.rejects(service.ask({lessonToken,question:'What did I learn?'}),{code:'video_budget_exceeded'});
  assert.equal((await service.inspect({lessonToken})).cost.conservativeUsd,.08);
});
test('invented cross-video citations are rejected rather than presented as memory',async t=>{
  const {service}=await setup(t,{async generate({source}){return fixture(source);},async ask(){return {answer:'Unfounded answer',citations:[{videoId:'DiVPAjgmnj0',anchorId:'fake'}]};}});
  const {lessonToken}=await service.generate(input);
  await assert.rejects(service.ask({lessonToken,question:'Where was this taught?'}),/invalid_citation/);
});
test('a failed generation preserves prior lessons and caches no synthetic success',async t=>{
  let fail=false;const {service}=await setup(t,{async generate({source}){if(fail)throw Object.assign(Error('quota'),{code:'free_tier_quota_exhausted',status:429});return fixture(source);}});
  const {lessonToken}=await service.generate(input);fail=true;
  await assert.rejects(service.generate({...input,profile:{...input.profile,interests:['retail']}}),/quota/);
  assert.ok((await service.inspect({lessonToken})).lesson.id);
});
test('provider preflight rejects oversized spend before generation and sanitizes provider failures',async()=>{
  const env={AI_PROVIDER:'gemini',GEMINI_MODEL:'gemini-3.8-flash',GEMINI_API_KEY:'private-test-key'};
  const gate={reason:()=>null,reserve:()=>null,observeResponse:()=>null};let generated=false;
  const provider=createStudyProvider({env,generationGate:gate,fetchImpl:async url=>{
    if(url.endsWith(':countTokens'))return new Response(JSON.stringify({totalTokens:100000}),{status:200});
    generated=true;throw Error('private-test-key');
  }});
  await assert.rejects(provider.generate({source:{anchors:[],title:'test'},profile:{language:'en'},prior:[],budget:{reserve:async amount=>{if(amount>=.1)throw Error('video_budget_exceeded');}}}),/video_budget_exceeded/);
  assert.equal(generated,false);
});
test('only signed matching practice evidence can shape later learning context',async t=>{
  const {service}=await setup(t),first=await service.generate(input);
  const attempt=await service.answer({lessonToken:first.lessonToken,taskId:'exercise-1',choice:0});
  const next=await service.generate({...input,profile:{...input.profile,interests:['retail']},memory:[{lessonToken:first.lessonToken,feedbackTokens:[attempt.feedbackToken]}]});
  assert.equal(next.lesson.priorConcepts[0].status,'exercise-key-matched-not-mastery');
  await assert.rejects(service.generate({...input,memory:[{lessonToken:first.lessonToken,feedbackTokens:['forged'] }]}),{code:'invalid_lesson_token'});
});
test('a transient provider failure retains safe diagnostics without leaking the provider body',async()=>{
  const gate={reason:()=>null,reserve:()=>null,observeResponse:()=>null},failure=[];
  const provider=createStudyProvider({env:{AI_PROVIDER:'gemini',GEMINI_MODEL:'gemini-3.8-flash',GEMINI_API_KEY:'private-test-key'},generationGate:gate,
    fetchImpl:async url=>url.endsWith(':countTokens')?new Response('{"totalTokens":2000}',{status:200}):new Response('{"error":{"code":503,"status":"UNAVAILABLE","message":"private-test-key"}}',{status:503})});
  await assert.rejects(provider.generate({source:{anchors:[],title:'test'},profile:{language:'en'},prior:[],budget:{reserve:async()=>{},failure:async d=>failure.push(d)}}),error=>error.code==='provider_temporarily_unavailable'&&!error.message.includes('private-test-key'));
  assert.equal(failure[0].httpStatus,503);assert.equal(failure[0].providerStatus,'UNAVAILABLE');assert.equal(failure[0].transient,true);
  assert.ok(!JSON.stringify(failure).includes('private-test-key'));
});
test('preflight counts the complete generation request including system and output schema',async()=>{
  const bodies=[];
  const provider=createStudyProvider({env:{AI_PROVIDER:'gemini',GEMINI_MODEL:'gemini-3.8-flash',GEMINI_API_KEY:'test-key'},
    fetchImpl:async(url,options)=>{bodies.push(JSON.parse(options.body));return new Response('{"totalTokens":2000}',{status:200});}});
  await assert.rejects(provider.generate({source:{anchors:[],title:'test'},profile:{language:'en'},budget:{reserve:async()=>{throw Error('stop-before-generation');}}}),/stop-before-generation/);
  assert.ok(bodies[0].generateContentRequest.systemInstruction);
  assert.ok(bodies[0].generateContentRequest.generationConfig.responseSchema);
  assert.equal(bodies[0].contents,undefined);
});
test('unexpected provider usage is recorded and stops the operation when the budget is exceeded',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'delta-study-budget-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const state=createStudyState({directory,key:'test-only'}),id='a'.repeat(64),budget=state.budget(id);
  await budget.reserve(.04);
  await assert.rejects(budget.settle(.11,{inputTokens:1,outputTokens:1}),{code:'video_budget_exceeded'});
  assert.equal((await state.budget(id).value()).conservativeUsd,.11);
  await assert.rejects(state.budget(id).reserve(.001),{code:'video_budget_exceeded'});
});
test('PowerPoint download tickets are bounded, expire and contain the actual saved lesson',async t=>{
  let clock=Date.now();const directory=await mkdtemp(path.join(os.tmpdir(),'delta-study-download-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const service=createStudyService({directory,sources:[parseStudySource(source)],env,now:()=>clock,provider:{async generate({source}){return fixture(source);}}});
  const {lessonToken}=await service.generate(input),ticket=await service.preparePptx({lessonToken});
  const file=await service.downloadPptx(ticket.id);assert.equal(file.buffer.subarray(0,2).toString(),'PK');assert.match(file.filename,/733mgqrzNKs/);
  await assert.rejects(service.preparePptx({lessonToken:'forged'}),{code:'invalid_lesson_token'});
  clock+=91000;await assert.rejects(service.downloadPptx(ticket.id),{code:'download_expired'});
});
