import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningLibrary, learningEntryState, LEARNING_LIBRARY_KEY } from './learning-library.js';
import { LEARNING_STORE_PREFIX } from './learning-protocol.js';

const pilot='dI8w0utjUc0',other='DiVPAjgmnj0',endpoint='https://delta.example';
function fixture(initial={}){
  const data=structuredClone(initial),storage={async get(key){return {[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));}};
  const library=createLearningLibrary({api:{storage:{local:storage}},repository:{async read(){return {videos:{}};}},readEndpoint:async()=>endpoint,panelSender:sender=>sender?.kind==='panel',contentSender:sender=>sender?.kind==='content',now:()=>1792000000000});
  return {data,storage,library};
}

test('dismissing another current video persists without creating saved lesson or playback evidence',async()=>{
  const f=fixture(),sender={kind:'content',url:`https://www.youtube.com/watch?v=${other}`};
  await f.library.dismiss(other,sender);
  assert.deepEqual(await learningEntryState(f.storage,other),{learningDismissed:true,learningEnrolled:false});
  const listed=await f.library.list({kind:'panel'});
  assert.deepEqual(listed.items,[]);
  assert.equal(listed.journal.summary.learning,0);
  assert.equal(listed.journal.summary.videos,0);
});

test('general video affordances cannot create fake legacy saved lessons',async()=>{
  const f=fixture();
  await assert.rejects(f.library.enrol(other,{kind:'panel'}),/supported SUMIF/);
  assert.equal(f.data[LEARNING_LIBRARY_KEY],undefined);
  for(const sender of [{kind:'foreign'},{kind:'content',url:`https://www.youtube.com/watch?v=${pilot}`}])await assert.rejects(f.library.dismiss(other,sender));
  assert.equal(f.data[LEARNING_LIBRARY_KEY],undefined);
});

test('a same-service existing SUMIF lesson remains available without exposing its private workspace',async()=>{
  const f=fixture({[`${LEARNING_STORE_PREFIX}${pilot}`]:{endpoint,value:{lesson:{title:'Existing SUMIF'},lessonToken:'private-capability',profile:{interests:['private-interest']}}}});
  const listed=await f.library.list({kind:'panel'});
  assert.equal(listed.items.length,1);
  assert.equal(listed.items[0].videoId,pilot);
  assert.equal(listed.items[0].hasLesson,true);
  assert.equal(JSON.stringify(listed).includes('private-'),false);
  assert.equal(f.data[`${LEARNING_STORE_PREFIX}${pilot}`].value.lessonToken,'private-capability');
});
