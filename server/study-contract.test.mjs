import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudySource, StudyError } from './study/source.mjs';
import { validateStudyLesson, publicStudyLesson, resolveStudyCitations, STUDY_SCHEMA } from './study/contract.mjs';
import * as contract from './study/contract.mjs';

const input = { videoId: '733mgqrzNKs', title: 'Time value of money', start: 0, end: 60,
  text: 'YouTube transcript\nVideo ID: 733mgqrzNKs\nLanguage: en\nCaptions: auto-generated\n\n[0:00] Money today can earn interest.\n[0:20] Assume a hypothetical ten percent annual return.\n[0:40] One hundred becomes one hundred and ten after one year.\n[1:00] Another topic starts here.' };
function raw(source) { return { supported: true, title: 'Compare money across time', summary: 'Use a stated return and time horizon.',
  concepts: [{ label: 'Time value', explanation: 'Timing matters.', anchorIds: [source.anchors[0].id] }],
  slides: Array.from({length:4},(_,i)=>({ title:`Step ${i+1}`, body:'A hypothetical example.', bullets:['Check the assumptions.'], anchorId:source.anchors[0].id })),
  exercises: [0,1].map(i=>({question:`Scenario ${i+1}: choose the future value.`, options:['110','100','90'], correctIndex:0, explanation:'100 × 1.1 = 110.',hint:'Apply the stated rate.',anchorId:source.anchors[0].id})) }; }

test('caption provenance binds to the requested video and excludes text outside its clip',()=>{
  const source=parseStudySource(input);
  assert.equal(source.videoUrl,'https://www.youtube.com/watch?v=733mgqrzNKs');
  assert.equal(source.captionType,'auto-generated');
  assert.ok(source.anchors.every(a=>a.start>=0&&a.end<=60));
  assert.ok(!JSON.stringify(source.anchors).includes('Another topic'));
  assert.throws(()=>parseStudySource({...input,videoId:'DiVPAjgmnj0'}),/source_identity/);
  assert.throws(()=>parseStudySource({...input,end:301}),/invalid_clip/);
});
test('source content changes invalidate the cache digest',()=>{
  assert.notEqual(parseStudySource(input).digest,parseStudySource({...input,text:input.text.replace('ten percent','five percent')}).digest);
});
test('generated lessons resolve known anchors and never expose exercise keys before checking',()=>{
  const source=parseStudySource(input), lesson=validateStudyLesson(raw(source),source), visible=publicStudyLesson(lesson);
  assert.equal(visible.slides[0].sourceTime,0);
  assert.equal(visible.exercises[0].correctIndex,undefined);
  assert.equal(visible.exercises[0].explanation,undefined);
  assert.equal(lesson.exercises[0].correctIndex,0);
});
test('invented anchors and ambiguous answer keys cannot become teaching evidence',()=>{
  const source=parseStudySource(input), value=raw(source);
  value.slides[0].anchorId='foreign-source';
  assert.throws(()=>validateStudyLesson(value,source),/invalid_provider_output/);
  value.slides[0].anchorId=source.anchors[0].id; value.exercises[0].correctIndex=3;
  assert.throws(()=>validateStudyLesson(value,source),/invalid_provider_output/);
});
test('memory citations use owned source anchors rather than model supplied URLs or timestamps',()=>{
  const source=parseStudySource(input);
  const [citation]=resolveStudyCitations([{videoId:input.videoId,anchorId:source.anchors[0].id,url:'https://evil.test',start:999}], [source]);
  assert.equal(citation.url,'https://www.youtube.com/watch?v=733mgqrzNKs&t=0s');
  assert.throws(()=>resolveStudyCitations([{videoId:'DiVPAjgmnj0',anchorId:source.anchors[0].id}],[source]),/invalid_citation/);
});

test('Gemini schema expresses the existing array and integer bounds without unsupported string keywords',()=>{
  const p=STUDY_SCHEMA.properties;
  for(const [schema,min,max] of [[p.concepts,1,4],[p.concepts.items.properties.anchorIds,1,3],[p.slides,4,4],
    [p.slides.items.properties.bullets,0,3],[p.exercises,2,2],[p.exercises.items.properties.options,3,3]]){
    assert.equal(schema.minItems,min);assert.equal(schema.maxItems,max);
  }
  assert.equal(p.exercises.items.properties.correctIndex.minimum,0);assert.equal(p.exercises.items.properties.correctIndex.maximum,2);
  const strings=[[p.title,160],[p.summary,700],[p.concepts.items.properties.label,100],[p.concepts.items.properties.explanation,500],
    [p.slides.items.properties.title,100],[p.slides.items.properties.body,550],[p.slides.items.properties.bullets.items,180],
    [p.exercises.items.properties.question,750],[p.exercises.items.properties.options.items,450],
    [p.exercises.items.properties.explanation,600],[p.exercises.items.properties.hint,350]];
  for(const [schema,max] of strings){assert.equal(schema.type,'STRING');assert.match(schema.description,new RegExp(`\\b${max}\\b`));}
  assert.ok(!/"(?:minLength|maxLength)"/.test(JSON.stringify(STUDY_SCHEMA)));
});

test('source-bound schemas clone independently and enumerate only the supplied anchors',()=>{
  const source=parseStudySource(input);assert.equal(typeof contract.studySchemaForSource,'function');
  const schema=contract.studySchemaForSource(source),p=schema.properties,ids=source.anchors.map(anchor=>anchor.id);
  assert.deepEqual(p.concepts.items.properties.anchorIds.items.enum,ids);
  assert.deepEqual(p.slides.items.properties.anchorId.enum,ids);
  assert.deepEqual(p.exercises.items.properties.anchorId.enum,ids);
  p.slides.items.properties.anchorId.enum.push('mutated-schema');p.slides.minItems=0;
  assert.equal(STUDY_SCHEMA.properties.slides.minItems,4);assert.equal(STUDY_SCHEMA.properties.slides.items.properties.anchorId.enum,undefined);
  assert.deepEqual(contract.studySchemaForSource(source).properties.slides.items.properties.anchorId.enum,ids);
});

function failure(operation){let error;try{operation();}catch(caught){error=caught;}
  assert.ok(error instanceof StudyError,'Contract failures must retain the typed application error');
  assert.ok(error.diagnostics,'Contract failures must retain safe machine-readable diagnostics');
  const allowed=new Set(['step','kind','path','reason','retryable','count','length','minimum','maximum']);
  assert.ok(Object.keys(error.diagnostics).every(key=>allowed.has(key)));
  for(const field of ['count','length','minimum','maximum'])if(Object.hasOwn(error.diagnostics,field))assert.ok(Number.isSafeInteger(error.diagnostics[field])&&error.diagnostics[field]>=0);
  return error;
}

test('all existing text limits remain exact and oversized text yields only path, length and limits',()=>{
  const source=parseStudySource(input),cases=[
    ['title',160,(r,v)=>r.title=v],['summary',700,(r,v)=>r.summary=v],
    ['concepts[0].label',100,(r,v)=>r.concepts[0].label=v],['concepts[0].explanation',500,(r,v)=>r.concepts[0].explanation=v],
    ['slides[0].title',100,(r,v)=>r.slides[0].title=v],['slides[0].body',550,(r,v)=>r.slides[0].body=v],
    ['slides[0].bullets[0]',180,(r,v)=>r.slides[0].bullets[0]=v],['exercises[0].question',750,(r,v)=>r.exercises[0].question=v],
    ['exercises[0].options[0]',450,(r,v)=>r.exercises[0].options[0]=v],['exercises[0].explanation',600,(r,v)=>r.exercises[0].explanation=v],
    ['exercises[0].hint',350,(r,v)=>r.exercises[0].hint=v],
  ];
  for(const [path,max,set] of cases){
    const value=raw(source);set(value,'x'.repeat(max));assert.doesNotThrow(()=>validateStudyLesson(value,source));
    const secret='PRIVATE_OUTPUT_DO_NOT_LOG';set(value,(secret+'x'.repeat(max)).slice(0,max+1));
    const error=failure(()=>validateStudyLesson(value,source));
    assert.equal(error.code,'invalid_provider_output');assert.equal(error.status,502);
    assert.deepEqual(error.diagnostics,{step:'lesson_contract',kind:'format',path,reason:'string_too_long',retryable:true,length:max+1,minimum:1,maximum:max});
    assert.ok(!JSON.stringify(error).includes(secret));assert.ok(!JSON.stringify(error.diagnostics).includes(source.anchors[0].id));
  }
});

test('every bounded collection names its canonical count path on rejection',()=>{
  const source=parseStudySource(input),cases=[
    ['concepts',0,1,4,r=>r.concepts=[]],['concepts',5,1,4,r=>r.concepts=Array(5).fill(r.concepts[0])],
    ['slides',3,4,4,r=>r.slides.pop()],['slides',5,4,4,r=>r.slides.push(r.slides[0])],
    ['exercises',1,2,2,r=>r.exercises.pop()],['exercises',3,2,2,r=>r.exercises.push(r.exercises[0])],
    ['concepts[0].anchorIds',0,1,3,r=>r.concepts[0].anchorIds=[]],['concepts[0].anchorIds',4,1,3,r=>r.concepts[0].anchorIds=Array(4).fill(source.anchors[0].id)],
    ['slides[0].bullets',4,0,3,r=>r.slides[0].bullets=Array(4).fill('A bullet')],
    ['exercises[0].options',2,3,3,r=>r.exercises[0].options.pop()],['exercises[0].options',4,3,3,r=>r.exercises[0].options.push('80')],
  ];
  for(const [path,count,minimum,maximum,change] of cases){const value=raw(source);change(value);const error=failure(()=>validateStudyLesson(value,source));
    assert.deepEqual(error.diagnostics,{step:'lesson_contract',kind:'format',path,reason:'array_count_out_of_range',retryable:true,count,minimum,maximum});}
  const permitted=raw(source);permitted.slides[0].bullets=[];permitted.concepts=Array(4).fill(permitted.concepts[0]);
  permitted.concepts[0].anchorIds=Array(3).fill(source.anchors[0].id);assert.doesNotThrow(()=>validateStudyLesson(permitted,source));
});

test('integer, duplicate-option and malformed-object failures stay typed and sanitized',()=>{
  const source=parseStudySource(input);
  for(const [path,reason,change] of [
    ['exercises[0].correctIndex','integer_out_of_range',r=>r.exercises[0].correctIndex=3],
    ['exercises[0].correctIndex','expected_integer',r=>r.exercises[0].correctIndex=1.5],
    ['exercises[0].options','duplicate_options',r=>r.exercises[0].options=[' private-option ','private-option','other']],
    ['concepts[0]','expected_object',r=>r.concepts[0]=null],['slides[0]','expected_object',r=>r.slides[0]=null],
    ['exercises[0]','expected_object',r=>r.exercises[0]=null],['slides[0].bullets','expected_array',r=>r.slides[0].bullets=null],
    ['title','expected_string',r=>r.title={private:'private-field'}],['summary','blank_string',r=>r.summary='  '],
    ['slides[0].body','disallowed_control_character',r=>r.slides[0].body='private-text\u0000'],
  ]){const value=raw(source);change(value);const error=failure(()=>validateStudyLesson(value,source));
    assert.equal(error.diagnostics.path,path);assert.equal(error.diagnostics.reason,reason);assert.equal(error.diagnostics.kind,'format');
    assert.ok(!JSON.stringify(error).includes('private-'));}
});

test('unsupported sources and unknown anchors remain non-retryable without exposing supplied IDs',()=>{
  const source=parseStudySource(input),unsupported=failure(()=>validateStudyLesson({...raw(source),supported:false},source));
  assert.equal(unsupported.code,'unsupported_source');assert.equal(unsupported.status,422);assert.equal(unsupported.diagnostics.retryable,false);
  for(const [path,change] of [
    ['concepts[0].anchorIds[0]',r=>r.concepts[0].anchorIds[0]='private-unknown-anchor'],
    ['slides[0].anchorId',r=>r.slides[0].anchorId='private-unknown-anchor'],
    ['exercises[0].anchorId',r=>r.exercises[0].anchorId='private-unknown-anchor'],
  ]){const value=raw(source);change(value);const error=failure(()=>validateStudyLesson(value,source));
    assert.equal(error.code,'invalid_provider_output');assert.equal(error.diagnostics.kind,'source_integrity');assert.equal(error.diagnostics.path,path);
    assert.equal(error.diagnostics.reason,'unknown_anchor');assert.equal(error.diagnostics.retryable,false);assert.ok(!JSON.stringify(error).includes('private-unknown-anchor'));}
});

test('citation failures retain safe canonical paths and never raw source or anchor identities',()=>{
  const source=parseStudySource(input);
  for(const [path,citations] of [
    ['citations[0].videoId',[{videoId:'private-video-id',anchorId:'private-anchor-id'}]],
    ['citations[0].anchorId',[{videoId:input.videoId,anchorId:'private-anchor-id'}]],
  ]){const error=failure(()=>resolveStudyCitations(citations,[source]));
    assert.equal(error.code,'invalid_citation');assert.equal(error.diagnostics.step,'citation_contract');assert.equal(error.diagnostics.path,path);
    assert.equal(error.diagnostics.kind,'source_integrity');assert.equal(error.diagnostics.retryable,false);
    assert.ok(!/private-|733mgqrzNKs/.test(JSON.stringify(error)));}
  const count=failure(()=>resolveStudyCitations([], [source]));assert.equal(count.diagnostics.count,0);assert.equal(count.diagnostics.minimum,1);assert.equal(count.diagnostics.maximum,6);
});
