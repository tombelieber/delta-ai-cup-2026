import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBillingStore} from './billing/store.mjs';
import {createPurchaseLedger} from './billing/ledger.mjs';
import {createPaidUsage} from './billing/usage.mjs';
import {createStudyEntitlements,createFirestoreEntitlementStore} from './study/entitlements.mjs';
import {createStudyService} from './study/service.mjs';
import {parseStudySource} from './study/source.mjs';
import {PROJECT_BUDGET_ENFORCED,STUDY_PROJECT_BUDGET_PATH} from './study/project-budget.mjs';
import {firestoreStore} from './billing-test-support.mjs';
const key=Buffer.alloc(32,19),id='00000000-0000-4000-8000-000000000001';
const source=parseStudySource({videoId:'abcdefghijk',title:'Synthetic teaching source',start:0,end:60,text:'Video ID: abcdefghijk\nCaptions: authored\n[0:00] Compare alternatives on the same date.\n[0:20] A hypothetical ten percent rate makes 100 become 110.\n[0:40] Timing changes the comparison.\n[1:00] End.'});
const lesson=s=>({supported:true,title:'Compare dates',summary:'A synthetic lesson.',concepts:[{label:'Timing',explanation:'Use the same date.',anchorIds:[s.anchors[0].id]}],slides:[0,1,2,3].map(i=>({title:`Step ${i+1}`,body:'Use the same date.',bullets:['Compare timing.'],anchorId:s.anchors[0].id})),exercises:[0,1].map(i=>({question:`Apply timing ${i}`,options:['Same date','Different dates','Never compare'],correctIndex:0,explanation:'Compare on one date.',hint:'Consider the date.',anchorId:s.anchors[0].id}))});
async function fixture(){
  const {firestore,records}=firestoreStore(new Map([[STUDY_PROJECT_BUDGET_PATH,{schemaVersion:1,limitMicros:10000000,reservedMicros:0,spentMicros:0}]]));
  const store=createBillingStore(firestore),ledger=createPurchaseLedger({store,key,merchantId:'acct_fixture',newId:()=>id}),usage=createPaidUsage({store,key});
  await ledger.open('alice',id);await ledger.attach(id,{id:'cs_test_fixture',url:'https://checkout.stripe.com/c/pay/cs_test_fixture',expiresAt:2000});await ledger.reserveCapacity(id,'pi_fixture');await ledger.grant(id,'pi_fixture');
  return {records,firestore,store,ledger,usage,entitlements:createStudyEntitlements({store:createFirestoreEntitlementStore(firestore,{paidEnabled:true}),key})};
}
test('actual Firestore adapters combine free and paid imports atomically, preserve registrations after refund, and never alter free AI accounts',async()=>{
  const f=await fixture(),user=f.entitlements.forUser('alice'),videos=Array.from({length:100},(_,i)=>String(i).padStart(11,'0'));
  assert.deepEqual((await user.snapshot()).imports,{limit:110,used:0,remaining:110});
  assert.deepEqual((await f.entitlements.forUser('bob').snapshot()).imports,{limit:10,used:0,remaining:10});
  await user.register({operationId:'one',videoIds:videos});await user.register({operationId:'two',videoIds:Array.from({length:10},(_,i)=>String(i+100).padStart(11,'0'))});
  assert.deepEqual((await user.snapshot()).imports,{limit:110,used:110,remaining:0});
  await assert.rejects(user.register({operationId:'no-more',videoIds:['99999999999']}),{status:402});
  await user.assertRegistered(videos.slice(0,12));await assert.rejects(f.entitlements.forUser('bob').assertRegistered(videos.slice(0,1)),{status:403});
  await f.ledger.revoke(id,{refunded:true});await user.assertRegistered(videos.slice(0,12));assert.equal((await user.snapshot()).imports.used,110);
  assert.equal([...f.records.keys()].some(p=>p.startsWith('studyAccounts/')),false);
});
test('paid user with exhausted free credit completes generation, two answers, real practice/export, and restores encrypted result after runtime loss',async t=>{
  const f=await fixture(),directory=await mkdtemp(path.join(os.tmpdir(),'delta-paid-integration-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let generations=0,questions=0;
  const env={STUDY_ACCESS_MODE:'google',STUDY_ORIGIN:'http://127.0.0.1',LEARNING_SIGNING_KEY_BASE64:key.toString('base64'),GEMINI_MODEL:'gemini-3.8-flash',GEMINI_PAID_BUDGET_APPROVED:'true'};
  const userQuota={[PROJECT_BUDGET_ENFORCED]:true,forUser(){throw Error('paid use must not touch exhausted free credit');}};
  const provider={async generate({source,budget}){generations++;await budget.reserve(.03);await budget.settle(.012);return lesson(source);},async ask({budget}){questions++;await budget.reserve(.01);await budget.settle(.003);return {answer:'Compare on the same date.',citations:[{videoId:source.videoId,anchorId:source.anchors[0].id}]};}};
  const construct=()=>createStudyService({directory,sources:[source],provider,userQuota,paidUsage:f.usage,env}),service=construct(),context={principal:{uid:'alice'}},input={videoId:source.videoId,funding:'paid'};
  const first=await service.generate(input,context);assert.equal(first.lesson.funding,'paid');assert.equal((await f.usage.snapshot('alice')).sessions.remaining,19);
  assert.equal((await service.answer({lessonToken:first.lessonToken,taskId:'exercise-1',choice:0},context)).passed,true);
  const q={lessonToken:first.lessonToken,question:'Why compare dates?'};await service.ask(q,context);assert.equal((await service.ask(q,context)).cached,true);
  await service.ask({...q,question:'Where did I learn this?'},context);await assert.rejects(service.ask({...q,question:'Third new question?'},context),{code:'paid_followups_exhausted'});
  assert.equal(questions,2);const file=await service.exportPptx({lessonToken:first.lessonToken},context);assert.equal(file.buffer.subarray(0,2).toString(),'PK');
  await rm(directory,{recursive:true,force:true});const restored=await construct().generate(input,context);assert.equal(restored.lesson.id,first.lesson.id);assert.equal(restored.cached,true);assert.equal(generations,1);
  await assert.rejects(service.inspect({lessonToken:first.lessonToken},{principal:{uid:'bob'}}),{status:403});
  const receipts=[...f.records].filter(([p])=>p.startsWith('studyPaidDeliveries/'));assert.equal(receipts.length,1);assert.equal(JSON.stringify(receipts).includes('Compare on the same date'),false);
  assert.equal(f.records.get(STUDY_PROJECT_BUDGET_PATH).spentMicros,18000);
});
test('invalid sources and failed generation do not consume paid units; failed follow-up costs use recovery capacity',async t=>{
  const f=await fixture(),directory=await mkdtemp(path.join(os.tmpdir(),'delta-paid-failure-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let broken=true;
  const env={STUDY_ACCESS_MODE:'google',STUDY_ORIGIN:'http://127.0.0.1',LEARNING_SIGNING_KEY_BASE64:key.toString('base64'),GEMINI_MODEL:'gemini-3.8-flash'};
  const service=createStudyService({directory,sources:[source],env,userQuota:{forUser(){}},paidUsage:f.usage,provider:{async generate({source,budget}){await budget.reserve(.02);await budget.settle(.01);if(broken)throw Error('synthetic failure');return lesson(source);},async ask({budget}){await budget.reserve(.01);await budget.settle(.004);return {answer:'bad source',citations:[{videoId:'zzzzzzzzzzz',anchorId:'invented'}]};}}});
  const context={principal:{uid:'alice'}};await assert.rejects(service.generate({videoId:'not-a-video',funding:'paid'},context),{code:'source_unavailable'});assert.equal((await f.usage.snapshot('alice')).sessions.remaining,20);
  await assert.rejects(service.generate({videoId:source.videoId,funding:'paid'},context),/synthetic failure/);assert.equal((await f.usage.snapshot('alice')).sessions.remaining,20);
  broken=false;const result=await service.generate({videoId:source.videoId,funding:'paid'},context);await assert.rejects(service.ask({lessonToken:result.lessonToken,question:'Where?'},context),{code:'invalid_citation'});
  const order=await f.ledger.order(id);assert.equal(order.spent.recovery,14000);assert.equal(order.spent.learning,10000);assert.equal(order.sessionsUsed,1);
});

test('paid map classification uses its own capacity with zero free AI credit and no learning unit charge',async()=>{
  const {createStudyClassificationService}=await import('./study/classification.mjs');const f=await fixture();let calls=0;
  const classification=createStudyClassificationService({accounts:{forUser(){throw Error('must not use free credit');}},paidAccounts:f.usage,env:{GEMINI_MODEL:'gemini-3.8-flash'},provider:{async classifyMetadata({videos,budget}){calls++;await budget.reserve(.008);await budget.settle(.002);return [{videoId:videos[0].videoId,path:['Business','Finance'],confidence:'high',contentType:'knowledge'}];}}});
  const input={funding:'paid',videos:[{videoId:source.videoId,title:'Synthetic finance lesson'}],existingPaths:[]},context={principal:{uid:'alice'}};
  const result=await classification.classify(input,context);assert.equal(result.items.length,1);await classification.classify(input,context);assert.equal(calls,1);assert.equal((await f.usage.snapshot('alice')).sessions.remaining,20);assert.equal((await f.ledger.order(id)).spent.classification,2000);
  await assert.rejects(classification.classify(input,{principal:{uid:'bob'}}),{code:'paid_allowance_exhausted'});
  await assert.rejects(classification.classify({...input,forgedGrant:true},context),{code:'invalid_classification_input'});
});
