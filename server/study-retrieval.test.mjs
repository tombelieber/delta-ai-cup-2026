import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {retrieveStudyContext} from './study/retrieval.mjs';
import {createStudyService} from './study/service.mjs';
import {createStudyState} from './study/state.mjs';

const videoA='AAAAAAAAAAA',videoB='BBBBBBBBBBB',videoC='CCCCCCCCCCC';
function lesson(videoId,{id=videoId,createdAt='2026-10-20T00:00:00.000Z',texts=['Synthetic caption.'],start=0,concepts=[]}={}){
  return {id,createdAt,concepts,exercises:[],costKey:'a'.repeat(64),source:{videoId,title:`Source ${videoId}`,
    videoUrl:`https://www.youtube.com/watch?v=${videoId}`,anchors:texts.map((text,i)=>({id:`${videoId}-${i}`,text,start:start+i*30,end:start+i*30+20}))}};
}
const retrieve=(question,primary,memory=[])=>retrieveStudyContext({question,primary,memory});

test('duplicate versions cannot crowd a different saved topic out of bounded recall',()=>{
  const primary=lesson(videoA,{texts:Array.from({length:20},(_,i)=>`Cash profit topic ${i}.`)});
  const versions=Array.from({length:6},(_,i)=>lesson(videoB,{id:`version-${i}`,createdAt:`2026-10-20T00:00:0${i}.000Z`,texts:Array.from({length:20},(_,j)=>`Cash profit version ${i} topic ${j}.`)}));
  const result=retrieve('cash profit',primary,versions);
  assert.equal(result.sources.length,2);
  assert.deepEqual(result.memories.slice(0,4).map(item=>item.videoId),[videoA,videoB,videoA,videoB]);
  assert.equal(result.memories.length,16);
  assert.equal(new Set(result.memories.map(item=>`${item.videoId}:${item.anchorId}`)).size,16);
  assert.ok(result.memories.filter(item=>item.videoId===videoB).every(item=>item.text.includes('version 5')));
});

test('active source wins its video and other sources use newest caller version with stable equal-date fallback',()=>{
  const primary=lesson(videoA,{id:'active',start:10,texts:['Active cash caption.']});
  const shadow=lesson(videoA,{id:'newer-active-video',createdAt:'2026-10-21T00:00:00Z',start:90,texts:['Different cash caption.']});
  const latest=lesson(videoB,{id:'latest',createdAt:'2026-10-21T00:00:00Z',texts:['Latest cash.']});
  const old=lesson(videoB,{id:'old',createdAt:'2026-10-19T00:00:00Z',texts:['Old cash.']});
  const result=retrieve('cash',primary,[shadow,latest,old]);
  assert.equal(result.sources[0],primary.source);
  assert.equal(result.sources[1],latest.source);
  assert.equal(result.memories.find(item=>item.videoId===videoA).text,'Active cash caption.');
  const tied=lesson(videoB,{id:'tied',createdAt:latest.createdAt,texts:['Later caller cash.']});
  assert.equal(retrieve('cash',primary,[latest,tied]).sources[1],tied.source);
});

test('ranking matches complete Unicode words and ignores bounded English question filler',()=>{
  const primary=lesson(videoA,{texts:['Interesting unrelated discussion.','Interest matters.','CAFÉ 資金 matters.']});
  const result=retrieve('What is the interest?',primary);
  assert.equal(result.memories[0].anchorId,`${videoA}-1`);
  assert.equal(result.memories[1].anchorId,`${videoA}-0`);
  assert.equal(retrieve('cafe\u0301 資金',primary).memories[0].anchorId,`${videoA}-2`);
});

test('caption overlap outranks concept labels and labels apply only to their own anchors',()=>{
  const primary=lesson(videoA,{texts:['Unrelated caption.','Profit caption.','Another unrelated caption.'],
    concepts:[{label:'cash profit liquidity',anchorIds:[`${videoA}-0`]}]});
  assert.deepEqual(retrieve('cash profit liquidity',primary).memories.map(item=>item.anchorId),[`${videoA}-1`,`${videoA}-0`,`${videoA}-2`]);
});

test('source relevance orders round-robin groups; exact ties prefer active source then stable video and time order',()=>{
  const primary=lesson(videoB,{texts:['Cash only.','Cash again.']});
  const other=lesson(videoA,{texts:['Cash profit.','Cash profit again.']});
  assert.deepEqual(retrieve('cash profit',primary,[other]).memories.slice(0,4).map(item=>item.videoId),[videoA,videoB,videoA,videoB]);
  const tied=lesson(videoC,{texts:['Cash topic.','Cash topic later.']});
  assert.deepEqual(retrieve('cash',primary,[tied,other]).memories.slice(0,3).map(item=>item.videoId),[videoB,videoA,videoC]);
});

test('selection caps text and anchor counts, skips oversized anchors and does not duplicate identities',()=>{
  const primary=lesson(videoA,{texts:['cash '.repeat(3000),'cash '.repeat(2000),'cash '.repeat(1000),'tiny cash']});
  primary.source.anchors.push({...primary.source.anchors[3]});
  const result=retrieve('cash',primary,[lesson(videoB,{texts:['small cash']})]);
  assert.deepEqual(result.memories.map(item=>item.anchorId),[`${videoA}-1`,`${videoB}-0`,`${videoA}-3`]);
  assert.ok(result.memories.reduce((sum,item)=>sum+item.text.length,0)<=14000);
  assert.ok(result.memories.length<=16);
  assert.deepEqual(Object.keys(result.memories[0]),['videoId','title','anchorId','text']);
});

test('zero-overlap fallback remains deterministic and shares the bounded source coverage',()=>{
  const primary=lesson(videoB,{texts:['First topic.','Second topic.']});
  const other=lesson(videoA,{texts:['Other first.','Other second.']});
  const expected=[`${videoB}-0`,`${videoA}-0`,`${videoB}-1`,`${videoA}-1`];
  assert.deepEqual(retrieve('the and what is',primary,[other]).memories.map(item=>item.anchorId),expected);
  assert.deepEqual(retrieve('unknown',primary,[other]).memories.map(item=>item.anchorId),expected);
});

async function serviceFixture(t,ask){
  const directory=await mkdtemp(path.join(os.tmpdir(),'delta-retrieval-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const key=Buffer.alloc(32,37),state=createStudyState({directory,key});
  const env={STUDY_ACCESS_MODE:'google',STUDY_ORIGIN:'https://study.example.test',LEARNING_SIGNING_KEY_BASE64:key.toString('base64'),GEMINI_MODEL:'gemini-3.8-flash'};
  const calls=[];
  const service=createStudyService({directory,env,sources:[lesson(videoC).source],userQuota:{forUser(){return {
    check:async()=>{},session:async()=>({available:true,conservativeUsd:0,reservedUsd:0,spentUsd:0,limitUsd:.1,entries:[]}),
  };}},provider:{async ask(input){calls.push(input);return ask(input);}}});
  const seal=(value,ownerUid='alice')=>state.seal({...value,ownerUid});
  return {service,seal,calls,alice:{principal:{uid:'alice'}}};
}

test('ask binds selected caption text and citation boundaries to the same canonical source version',async t=>{
  const f=await serviceFixture(t,({memories})=>({answer:'Saved source answer.',citations:[videoB,videoA].map(videoId=>({videoId,anchorId:memories.find(item=>item.videoId===videoId).anchorId}))}));
  const primary=lesson(videoA,{texts:['Active cash source.'],start:10});
  const old=lesson(videoB,{id:'old',createdAt:'2026-10-19T00:00:00Z',start:20,texts:['Old cash source.']});
  const current=lesson(videoB,{id:'current',createdAt:'2026-10-20T00:00:00Z',start:90,texts:['Current cash source.']});
  const shadow=lesson(videoA,{id:'shadow',createdAt:'2026-10-21T00:00:00Z',start:200,texts:['Shadow cash source.']});
  const input={lessonToken:f.seal(primary),question:'cash',memory:[old,current,shadow].map(item=>({lessonToken:f.seal(item)}))};
  const answer=await f.service.ask(input,f.alice);
  assert.equal(answer.citations[0].start,90);
  assert.equal(answer.citations[0].end,110);
  assert.equal(answer.citations[0].url,`https://www.youtube.com/watch?v=${videoB}&t=90s`);
  assert.equal(answer.citations[1].start,10,'primary caption boundaries win over a newer memory of the active video');
  assert.equal(answer.citations[1].end,30);
  assert.deepEqual(f.calls[0].memories.map(item=>item.text),['Active cash source.','Current cash source.']);
  assert.equal(f.calls[0].memories.some(item=>item.videoId===videoC),false,'unsubmitted catalogue sources stay outside recall');
  await assert.rejects(f.service.ask({...input,memory:[{lessonToken:f.seal(current,'bob')}]},f.alice),{code:'lesson_access_denied'});
  assert.equal(f.calls.length,1,'foreign memory is rejected before provider dispatch');
});

test('ask keeps invalid citations fail-closed and unsupported answers uncited',async t=>{
  let citations=[{videoId:videoA,anchorId:`${videoA}-17`}];
  const f=await serviceFixture(t,()=>({answer:'The model claims a result.',citations}));
  const input={lessonToken:f.seal(lesson(videoA,{texts:Array.from({length:18},(_,i)=>`Cash caption ${i}.`)})),question:'cash'};
  await assert.rejects(f.service.ask(input,f.alice),{code:'invalid_citation'});
  citations=[];
  const answer=await f.service.ask(input,f.alice);
  assert.equal(answer.answer,'I could not find that in your saved learning sources.');
  assert.deepEqual(answer.citations,[]);
});
