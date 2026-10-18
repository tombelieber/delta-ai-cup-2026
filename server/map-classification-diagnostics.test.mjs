import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOutput,MapClassificationError} from './map-classification.mjs';
import {createStudyClassificationService} from './study/classification.mjs';
import {sanitizeStudyDiagnostics,createStudyFailureDiagnostic} from './study/diagnostics.mjs';
import {createStudyRouter} from './study/router.mjs';

const privateValue='private-user@example.test-private-token';
const videos=[{videoId:'733mgqrzNKs',title:privateValue},{videoId:'DiVPAjgmnj0',title:'Cash flow'}];
const group=()=>({path:['Business','Finance'],confidence:'high',contentType:'knowledge',videoIds:['733mgqrzNKs']});
const scenarios=[
  {name:'unknown video identifier',raw:()=>({groups:[{...group(),videoIds:['private-id!']}]}),path:'groups[0].videoIds[0]',reason:'unknown_video_id',index:0},
  {name:'duplicate video identifier',raw:()=>({groups:[{...group(),videoIds:['733mgqrzNKs','733mgqrzNKs']}]}),path:'groups[0].videoIds[1]',reason:'duplicate_video_id',index:1},
  {name:'too few path labels',raw:()=>({groups:[{...group(),path:['Finance']}]}),path:'groups[0].path',reason:'array_count_out_of_range',count:1,minimum:2,maximum:4},
  {name:'non Latin path label',raw:()=>({groups:[{...group(),path:['Business','財經']}]}),path:'groups[0].path[1]',reason:'disallowed_label',index:1},
  {name:'long path label',raw:()=>({groups:[{...group(),path:['Business','x'.repeat(81)]}]}),path:'groups[0].path[1]',reason:'string_too_long',index:1,length:81,maximum:80},
  {name:'control character in path',raw:()=>({groups:[{...group(),path:['Business','Finance\u0001']}]}),path:'groups[0].path[1]',reason:'disallowed_control_character',index:1},
  {name:'blank path label',raw:()=>({groups:[{...group(),path:['Business','  ']}]}),path:'groups[0].path[1]',reason:'blank_string',index:1},
  {name:'duplicate path labels',raw:()=>({groups:[{...group(),path:['Business','BUSINESS']}]}),path:'groups[0].path',reason:'duplicate_label'},
  {name:'reserved path',raw:()=>({groups:[{...group(),path:['More to explore','Finance']}]}),path:'groups[0].path[0]',reason:'reserved_path',index:0},
  {name:'non object envelope',raw:()=>null,path:'map',reason:'expected_object'},
  {name:'unexpected envelope field',raw:()=>({groups:[],[privateValue]:privateValue}),path:'map',reason:'unexpected_fields'},
  {name:'missing groups collection',raw:()=>({}),path:'groups',reason:'expected_array'},
  {name:'too many groups',raw:()=>({groups:[group(),group(),group()]}),path:'groups',reason:'array_count_out_of_range',count:3,maximum:2},
  {name:'non object group',raw:()=>({groups:[null]}),path:'groups[0]',reason:'expected_object',index:0},
  {name:'invalid confidence',raw:()=>({groups:[{...group(),confidence:privateValue}]}),path:'groups[0].confidence',reason:'invalid_enum',index:0},
  {name:'missing video identifiers',raw:()=>({groups:[{...group(),videoIds:[]}]}),path:'groups[0].videoIds',reason:'array_count_out_of_range',count:0,minimum:1,maximum:2},
];

for(const scenario of scenarios)test(`map semantic diagnostics identify ${scenario.name} without private values`,()=>{
  let error;try{validateOutput(scenario.raw(),videos);}catch(value){error=value;}
  assert.ok(error instanceof MapClassificationError);assert.equal(error.code,'invalid_provider_output');assert.equal(error.status,502);
  const {name,raw,...details}=scenario;
  assert.deepEqual(error.diagnostics,{step:'map_contract',kind:'format',phase:'validation',...details});
  assert.deepEqual(sanitizeStudyDiagnostics(error.diagnostics),error.diagnostics);
  const serialized=JSON.stringify(createStudyFailureDiagnostic('classify',error));
  for(const value of [privateValue,'733mgqrzNKs','private-id!','財經'])assert.ok(!serialized.includes(value));
});

test('valid classifications and safe omissions retain the exact established behavior',()=>{
  assert.deepEqual(validateOutput({groups:[group()]},videos),[{videoId:'733mgqrzNKs',path:['Business','Finance'],confidence:'high',contentType:'knowledge'}]);
  assert.deepEqual(validateOutput({groups:[]},videos),[]);
  assert.deepEqual(validateOutput({groups:[{...group(),path:['AI tools','Claude Code']}]},videos),[]);
});

test('map diagnostics accept only fixed path grammar and bounded machine indices',()=>{
  for(const path of ['groups[0].private','groups[0].videoIds[private-id!]','groups[10000].path','groups[0].path\n'])
    assert.equal(sanitizeStudyDiagnostics({path}).path,undefined);
  assert.deepEqual(sanitizeStudyDiagnostics({index:-1,reason:privateValue,step:privateValue,path:privateValue}),{});
  assert.deepEqual(sanitizeStudyDiagnostics({index:1e9}),{});
});

test('classification conversion and real router failure logging preserve safe semantic diagnostics',async()=>{
  const events=[];
  const service=createStudyClassificationService({env:{GEMINI_MODEL:'gemini-3.8-flash'},
    accounts:{forUser:()=>({check:async()=>{}})},provider:{classifyMetadata:async()=>validateOutput({groups:[{...group(),videoIds:['private-id!']}]},videos)}});
  const router=createStudyRouter({access:{mode:'google',check:()=>null}},
    {classificationService:service,accounts:{config:()=>({enabled:true}),authenticate:async()=>({uid:privateValue}),forUser:()=>({})},onDiagnostic:event=>events.push(event)});
  let response;
  await router({request:{method:'POST',headers:{'content-type':'application/json'}},response:{},
    url:new URL('https://study.example/api/study/classify'),json:(status,body)=>{response={status,body};},
    readBody:async()=>JSON.stringify({videos}),rateAllowed:()=>true});
  assert.equal(response.status,502);assert.equal(response.body.error,'invalid_provider_output');
  assert.equal(events.length,1);assert.equal(events[0].diagnostics.step,'map_contract');
  assert.equal(events[0].diagnostics.path,'groups[0].videoIds[0]');assert.equal(events[0].diagnostics.reason,'unknown_video_id');
  assert.equal(response.body.reference,events[0].reference);
  assert.ok(!JSON.stringify({response,events}).includes(privateValue));
});
