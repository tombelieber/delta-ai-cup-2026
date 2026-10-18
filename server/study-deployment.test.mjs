import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac} from 'node:crypto';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from './index.mjs';
import {createStudyService} from './study/service.mjs';
import {parseStudySource} from './study/source.mjs';
import {StudyError} from './study/source.mjs';
import {createStudyAccounts} from './study/accounts.mjs';
import {createStudyAccess} from './study/access.mjs';
import {createStudyRouter} from './study/router.mjs';
import {createLearningService} from './learning.mjs';
import {createRecommendationService} from './recommend.mjs';

const key=Buffer.alloc(32,23),origin='https://study.example.test';
const env={STUDY_ACCESS_MODE:'guarded',STUDY_ORIGIN:origin,LEARNING_SIGNING_KEY_BASE64:key.toString('base64'),GEMINI_MODEL:'gemini-3.8-flash'};
const token=createHmac('sha256',key).update('delta-study-private-access-v1').digest('base64url');
const source=parseStudySource({videoId:'733mgqrzNKs',title:'Timing',start:0,end:60,
  text:'Video ID: 733mgqrzNKs\nCaptions: authored\n[0:00] Compare money at the same date.\n[0:20] Assume a hypothetical ten percent rate.\n[0:40] One hundred becomes one hundred ten.\n[1:00] End.'});
const fixture={supported:true,title:'Compare timing',summary:'Use the same date.',concepts:[{label:'Timing',explanation:'Compare the dates.',anchorIds:[source.anchors[0].id]}],
  slides:[0,1,2,3].map(i=>({title:`Step ${i+1}`,body:'Assume a hypothetical rate.',bullets:['Compare dates.'],anchorId:source.anchors[0].id})),
  exercises:[0,1].map(i=>({question:`Scenario ${i+1}`,options:['110','100','90'],correctIndex:0,explanation:'100 times 1.1 is 110.',hint:'Use the rate.',anchorId:source.anchors[0].id}))};
const input={videoId:source.videoId};
async function setup(t,settings=env,{accounts,provider:customProvider,serverOptions={}}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'delta-study-deployment-'));let generations=0,queries=0;
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const provider={async generate({budget}){generations++;await budget.reserve(.02);await budget.settle(.01,{inputTokens:100,outputTokens:100});return structuredClone(fixture);},
    async ask({budget}){queries++;await budget.reserve(.01);await budget.settle(.005,{inputTokens:100,outputTokens:100});return {answer:'Compare the dates.',citations:[{videoId:source.videoId,anchorId:source.anchors[0].id}]};}};
  const service=createStudyService({directory,sources:[source],provider:customProvider||provider,env:settings,userQuota:accounts});
  const server=createServer({studyService:service,studyAccounts:accounts,allowedOrigins:'https://other.example.test',requestsPerMinute:100,...serverOptions});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  async function request(action,{method='GET',body,headers={}}={}){
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:action.startsWith('/')?action:`/api/study/${action}`,method,
        headers:Object.fromEntries(Object.entries({host:'study.example.test',origin,'sec-fetch-site':'same-origin',...(body===undefined?{}:{'content-type':'application/json'}),...headers}).filter(([,value])=>value!==undefined))},response=>{
        const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const buffer=Buffer.concat(chunks);let json;try{json=JSON.parse(buffer);}catch{}resolve({status:response.statusCode,headers:response.headers,json,buffer});});
      });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
    });
  }
  return {service,directory,provider,request,calls:()=>({generations,queries})};
}
const auth={'x-delta-study-token':token};

test('guarded study rejects unauthorized calls before body processing or model work',async t=>{
  const {request,calls}=await setup(t);
  for(const action of ['catalogue','generate','ask','inspect','preparePptx','pptx','answer']){
    const response=await request(action,{method:action==='catalogue'?'GET':'POST',body:action==='catalogue'?undefined:{}});
    assert.equal(response.status,401,action);assert.equal(response.json.error,'study_access_required');
  }
  assert.equal((await request('generate',{method:'POST',body:input,headers:{'x-delta-study-token':'x'.repeat(43)}})).status,401);
  assert.deepEqual(calls(),{generations:0,queries:0});
});

test('guarded study admits only the configured origin and ignores spoofed forwarded headers',async t=>{
  const {request}=await setup(t);
  assert.equal((await request('catalogue',{headers:auth})).status,200);
  for(const headers of [
    {...auth,origin:'https://other.example.test'},
    {...auth,host:'other.example.test',origin:'https://other.example.test','x-forwarded-host':'study.example.test'},
    {...auth,'sec-fetch-site':'cross-site'},
    {...auth,'sec-fetch-site':'same-site'},
  ])assert.equal((await request('catalogue',{headers})).status,403);
  assert.equal((await request('catalogue',{headers:{...auth,origin:undefined,'sec-fetch-site':undefined}})).status,200);
});

test('guarded configuration fails closed instead of using provider or legacy signing fallbacks',()=>{
  const create=settings=>createStudyService({directory:os.tmpdir(),env:settings});
  for(const settings of [
    {...env,LEARNING_SIGNING_KEY_BASE64:undefined,GEMINI_API_KEY:'test-key',LEARNING_SIGNING_KEY:'legacy'},
    {...env,LEARNING_SIGNING_KEY_BASE64:'',GEMINI_API_KEY:'test-key'},
    {...env,LEARNING_SIGNING_KEY_BASE64:'not-base64'},
    {...env,LEARNING_SIGNING_KEY_BASE64:Buffer.alloc(31).toString('base64')},
  ])assert.throws(()=>create(settings),{code:'signing_configuration_invalid'});
  for(const value of ['',undefined,'http://study.example.test','https://study.example.test/path','https://user@study.example.test','https://study.example.test?x=1']){
    assert.throws(()=>create({...env,STUDY_ORIGIN:value}),{code:'study_configuration_invalid'});
  }
  assert.throws(()=>create({...env,STUDY_ACCESS_MODE:'public'}),{code:'study_configuration_invalid'});
  assert.doesNotThrow(()=>create({...env,STUDY_ORIGIN:'http://127.0.0.1:8787'}));
});

test('explicit invalid base64 also cannot silently change a local saved-lesson key',()=>{
  assert.throws(()=>createStudyService({directory:os.tmpdir(),env:{LEARNING_SIGNING_KEY_BASE64:'',LEARNING_SIGNING_KEY:'legacy'}}),{code:'signing_configuration_invalid'});
});

test('guarded saved capabilities and owner access survive a service restart with stable signing bytes',async t=>{
  const {service,directory,provider,request,calls}=await setup(t);
  const generated=await request('generate',{method:'POST',body:input,headers:auth});
  assert.equal(generated.status,200);
  const restarted=createStudyService({directory,sources:[source],provider,env:{...env,GEMINI_API_KEY:'changed-provider-key'}});
  assert.equal(restarted.access?.ownerToken(),token);
  assert.notEqual(restarted.access?.ownerToken(),createHmac('sha256',key).update('delta-map-personal-access-v1').digest('base64url'));
  assert.equal((await restarted.inspect({lessonToken:generated.json.lessonToken})).lesson.id,generated.json.lesson.id);
  assert.equal((await restarted.generate(input)).cached,true);
  assert.deepEqual(calls(),{generations:1,queries:0});
  assert.equal(service.access?.ownerToken(),token);
  assert.ok(!JSON.stringify(generated.json).includes(token));
});

test('a missing guarded cost receipt blocks model followup and is reported as unavailable',async t=>{
  const {service,directory,calls}=await setup(t),generated=await service.generate(input);
  for(const name of await readdir(directory))if(name.endsWith('.cost.json'))await rm(path.join(directory,name));
  const inspected=await service.inspect({lessonToken:generated.lessonToken});
  assert.equal(inspected.cost.available,false);assert.equal(inspected.cost.conservativeUsd,null);
  assert.equal((await service.generate(input)).cost.available,false);
  await assert.rejects(service.ask({lessonToken:generated.lessonToken,question:'Compare the dates?'}),{code:'session_budget_unavailable'});
  assert.deepEqual(calls(),{generations:1,queries:0});
  assert.equal((await service.answer({lessonToken:generated.lessonToken,taskId:'exercise-1',choice:0})).passed,true);
  assert.equal((await service.exportPptx({lessonToken:generated.lessonToken})).buffer.subarray(0,2).toString(),'PK');
});

test('only exact GET download tickets bypass the owner header and still obey origin guards',async t=>{
  const {service,request}=await setup(t),generated=await service.generate(input),ticket=await service.preparePptx({lessonToken:generated.lessonToken});
  const action=ticket.url.slice('/api/study/'.length),download=await request(action);
  assert.equal(download.status,200);assert.equal(download.buffer.subarray(0,2).toString(),'PK');
  assert.equal((await request(action,{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await request(action,{method:'POST',body:{}})).status,401);
  assert.equal((await request('download/not-a-ticket')).status,401);
  assert.equal((await request('download/12345678-1234-4234-8234-123456789abc')).status,404);
});

test('local mode remains loopback-only and keeps the existing unauthenticated local control path',async t=>{
  const {request}=await setup(t,{LEARNING_SIGNING_KEY:'legacy-local',GEMINI_MODEL:env.GEMINI_MODEL});
  assert.equal((await request('catalogue',{headers:{host:'localhost',origin:'http://localhost'}})).status,200);
  assert.equal((await request('catalogue',{headers:auth})).status,403);
});

test('disabled study exposes a disabled auth configuration while legacy HTTP behavior stays available',async t=>{
  const {request,calls}=await setup(t,{LEARNING_SIGNING_KEY:'legacy-local',GEMINI_MODEL:env.GEMINI_MODEL},{serverOptions:{
    studyService:null,service:createRecommendationService({provider:{configured:false,reason:'provider_not_configured'}}),
  }});
  const config=await request('auth-config');
  assert.equal(config.status,200);assert.deepEqual(config.json,{enabled:false,limitUsd:.5});
  for(const [action,method] of [['catalogue','GET'],['session','GET'],['generate','POST'],['auth-config','POST']]){
    const response=await request(action,{method,...(method==='POST'?{body:{}}:{})});
    assert.equal(response.status,404);assert.equal(response.json.error,'study_disabled');
  }
  const legacy=await request('/api/recommendations',{method:'POST',body:{schemaVersion:1,watched:[]}});
  assert.equal(legacy.status,200);assert.equal(legacy.json.status,'unavailable');assert.equal(legacy.json.reason,'provider_not_configured');
  assert.deepEqual(calls(),{generations:0,queries:0});
});

const googleEnv={...env,STUDY_ACCESS_MODE:'google'};
const alice={principal:{uid:'alice'}},bob={principal:{uid:'bob'}};
test('Google study router cannot start without its verification and quota adapter',()=>{
  const service={access:createStudyAccess({env:googleEnv,key})};
  assert.throws(()=>createStudyRouter(service),{code:'firebase_configuration_invalid'});
});
function accountBoundary(){
  const events=[],balances=new Map();
  const balance=uid=>{if(!balances.has(uid))balances.set(uid,{limitUsd:.5,reservedUsd:0,spentUsd:0,remainingUsd:.5});return balances.get(uid);};
  const session=(uid,sessionId)=>{
    const reservations=events.filter(event=>event.type==='reserve'&&event.uid===uid&&event.sessionId===sessionId);
    let reservedUsd=0,spentUsd=0;
    for(const reservation of reservations){const settled=events.findLast(event=>event.type==='settle'&&event.operationId===reservation.operationId);
      if(settled)spentUsd+=settled.actualUsd;else reservedUsd+=reservation.amountUsd;}
    return {available:reservations.length>0,conservativeUsd:reservedUsd+spentUsd,reservedUsd,spentUsd,limitUsd:.1};
  };
  return {events,balances,
    config:()=>({enabled:true,firebase:{apiKey:'public-test-key',authDomain:'study.test',projectId:'study-test',appId:'app-test'},limitUsd:.5}),
    async authenticate(request){const uid={'Bearer alice-token':'alice','Bearer bob-token':'bob'}[request.headers.authorization];if(!uid)throw new StudyError('authentication_required',401);return {uid};},
    forUser(uid){return {
      async check(){events.push({type:'check',uid});if(balance(uid).remainingUsd<=0)throw new StudyError('study_credit_exhausted',402);return structuredClone(balance(uid));},
      async session(sessionId){return session(uid,sessionId);},
      async reserve(value){const current=balance(uid);if(value.amountUsd>current.remainingUsd)throw new StudyError('study_credit_exhausted',402);if(session(uid,value.sessionId).conservativeUsd+value.amountUsd>=.1)throw new StudyError('video_budget_exceeded',429);events.push({type:'reserve',uid,...value});current.reservedUsd+=value.amountUsd;current.remainingUsd-=value.amountUsd;return {...current,created:true,operationState:'reserved'};},
      async settle(value){events.push({type:'settle',uid,...value});const reserved=events.find(e=>e.type==='reserve'&&e.operationId===value.operationId);const current=balance(uid);current.reservedUsd-=reserved.amountUsd;current.spentUsd+=value.actualUsd;current.remainingUsd=.5-current.reservedUsd-current.spentUsd;return structuredClone(current);},
      async failure(value){events.push({type:'failure',uid,...value});return structuredClone(balance(uid));},
      async snapshot(){return structuredClone(balance(uid));},
    };},
  };
}
test('Google study exposes only public configuration before Firebase authentication',async t=>{
  const accounts=accountBoundary(),{request,calls}=await setup(t,googleEnv,{accounts});
  assert.equal((await request('auth-config')).json.enabled,true);
  assert.equal((await request('auth-config',{headers:{origin:'https://other.example.test'}})).status,403);
  assert.equal((await request('auth-config',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  for(const action of ['session','catalogue','generate','download/12345678-1234-4234-8234-123456789abc']){
    assert.equal((await request(action,{headers:auth})).status,401,action);
  }
  const session=await request('session',{headers:{authorization:'Bearer alice-token'}});
  assert.equal(session.status,200);assert.equal(session.json.user.uid,'alice');assert.equal(session.json.quota.remainingUsd,.5);
  assert.equal((await request('catalogue',{headers:{authorization:'Bearer alice-token'}})).status,200);
  assert.deepEqual(calls(),{generations:0,queries:0});
});

test('Google study scopes cache, lessons, practice, memory and export tickets to the verified user',async t=>{
  const accounts=accountBoundary(),{service}=await setup(t,googleEnv,{accounts});
  await assert.rejects(service.generate(input),{code:'authentication_required'});
  const first=await service.generate(input,alice),second=await service.generate(input,bob);
  assert.notEqual(first.lesson.id,second.lesson.id);assert.equal(second.cached,false);
  assert.equal((await service.generate(input,alice)).lesson.id,first.lesson.id);
  const attempt=await service.answer({lessonToken:first.lessonToken,taskId:'exercise-1',choice:0},alice);
  const ticket=await service.preparePptx({lessonToken:first.lessonToken},alice);
  for(const operation of [
    ()=>service.inspect({lessonToken:first.lessonToken},bob),
    ()=>service.answer({lessonToken:first.lessonToken,taskId:'exercise-1',choice:0},bob),
    ()=>service.ask({lessonToken:first.lessonToken,question:'Compare dates?'},bob),
    ()=>service.exportPptx({lessonToken:first.lessonToken},bob),
    ()=>service.preparePptx({lessonToken:first.lessonToken},bob),
    ()=>service.downloadPptx(ticket.id,bob),
    ()=>service.generate({...input,memory:[{lessonToken:first.lessonToken,feedbackTokens:[attempt.feedbackToken]}]},bob),
    ()=>service.generate({...input,memory:[{lessonToken:second.lessonToken,feedbackTokens:[attempt.feedbackToken]}]},bob),
  ])await assert.rejects(operation(),{code:'lesson_access_denied'});
  assert.equal((await service.downloadPptx(ticket.id,alice)).buffer.subarray(0,2).toString(),'PK');
});

test('private HTTP smoke origins cannot be used through a remote connection',()=>{
  const access=createStudyAccess({env:{...googleEnv,STUDY_ORIGIN:'http://127.0.0.1:8787'},key});
  const headers={host:'127.0.0.1:8787',origin:'http://127.0.0.1:8787'};
  assert.equal(access.check({headers,socket:{remoteAddress:'127.0.0.1'}}),null);
  assert.equal(access.check({headers,socket:{remoteAddress:'203.0.113.42'}})?.status,403);
});

test('Google credit checks precede provider work and stale local totals cannot override durable session credit',async t=>{
  const accounts=accountBoundary(),{service,directory,calls}=await setup(t,googleEnv,{accounts});
  accounts.balances.set('alice',{limitUsd:.5,reservedUsd:0,spentUsd:.5,remainingUsd:0});
  await assert.rejects(service.generate(input,alice),{code:'study_credit_exhausted'});
  assert.deepEqual(calls(),{generations:0,queries:0});
  const generated=await service.generate(input,bob);
  const costFile=(await readdir(directory)).find(name=>name.endsWith('.cost.json'));
  const cost=JSON.parse(await readFile(path.join(directory,costFile),'utf8'));cost.conservativeUsd=.099;
  await writeFile(path.join(directory,costFile),JSON.stringify(cost));
  const before=accounts.events.filter(e=>e.type==='reserve').length;
  assert.equal((await service.ask({lessonToken:generated.lessonToken,question:'Compare dates?'},bob)).cost.conservativeUsd,.015);
  assert.equal(accounts.events.filter(e=>e.type==='reserve').length,before+1);
  const reservation=accounts.events.find(e=>e.type==='reserve'),settlement=accounts.events.find(e=>e.type==='settle');
  assert.equal(reservation.uid,'bob');assert.equal(reservation.amountUsd,.02);assert.equal(settlement.actualUsd,.01);
  assert.equal(reservation.operationId,settlement.operationId);assert.match(reservation.operationId,/^[a-f0-9-]{36}$/);
});

test('Google study refuses old anonymous lesson capabilities rather than adopting their ownership',async t=>{
  const accounts=accountBoundary(),{service,directory,provider}=await setup(t,googleEnv,{accounts});
  const legacy=createStudyService({directory,sources:[source],provider,env:{LEARNING_SIGNING_KEY_BASE64:env.LEARNING_SIGNING_KEY_BASE64,GEMINI_MODEL:env.GEMINI_MODEL}});
  const old=await legacy.generate(input);
  await assert.rejects(service.inspect({lessonToken:old.lessonToken},alice),{code:'lesson_access_denied'});
});

test('Google provider failures retain both real lifetime credit and local session reservation',async t=>{
  const project='study-test-project',savedAccounts=new Map(),savedOperations=new Map();
  const accounts=createStudyAccounts({env:{FIREBASE_PROJECT_ID:project,FIREBASE_WEB_CONFIG:JSON.stringify({apiKey:'public',authDomain:'study.test',projectId:project,appId:'app'})},
    auth:{verifyIdToken:async()=>({uid:'alice',sub:'alice',aud:project,iss:`https://securetoken.google.com/${project}`,email:'test@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}})},
    store:{async transact(uid,operationId,reduce){const opKey=`${uid}/${operationId}`,update=await reduce(structuredClone(savedAccounts.get(uid)??null),structuredClone(savedOperations.get(opKey)??null));
      if(Object.hasOwn(update,'account'))savedAccounts.set(uid,structuredClone(update.account));
      if(Object.hasOwn(update,'operation'))savedOperations.set(opKey,structuredClone(update.operation));return update.result;}}});
  const provider={async generate({budget}){await budget.reserve(.04);await budget.failure({step:'generateContent',httpStatus:503});throw new StudyError('provider_temporarily_unavailable',503);}};
  const {service,directory}=await setup(t,googleEnv,{accounts,provider});
  await assert.rejects(service.generate(input,alice),{code:'provider_temporarily_unavailable'});
  assert.deepEqual(await accounts.forUser('alice').snapshot(),{limitUsd:.5,reservedUsd:.04,spentUsd:0,remainingUsd:.46});
  const filename=(await readdir(directory)).find(name=>name.endsWith('.cost.json'));
  const receipt=JSON.parse(await readFile(path.join(directory,filename),'utf8'));
  assert.equal(receipt.conservativeUsd,.04);assert.equal(receipt.entries[0].failure.httpStatus,503);
  assert.equal(savedOperations.size,1);
});

test('Google replayed lifetime reservations cannot authorize inference dispatch',async t=>{
  const accounts=accountBoundary();let dispatched=0;
  const user=accounts.forUser('alice');accounts.forUser=()=>({...user,async reserve(){return {created:false,operationState:'reserved'};}});
  const provider={async generate({budget}){await budget.reserve(.02);dispatched++;return structuredClone(fixture);}};
  const {service,directory}=await setup(t,googleEnv,{accounts,provider});
  await assert.rejects(service.generate(input,alice),{code:'credit_operation_conflict'});
  assert.equal(dispatched,0);assert.equal((await readdir(directory)).some(name=>name.endsWith('.cost.json')),false);
});

test('Google missing local receipts use the durable session for saved-source followup',async t=>{
  const accounts=accountBoundary(),{service,directory}=await setup(t,googleEnv,{accounts}),generated=await service.generate(input,alice);
  for(const filename of await readdir(directory))if(filename.endsWith('.cost.json'))await rm(path.join(directory,filename));
  assert.equal((await service.inspect({lessonToken:generated.lessonToken},alice)).cost.conservativeUsd,.01);
  assert.equal((await service.ask({lessonToken:generated.lessonToken,question:'Compare dates?'},alice)).cost.conservativeUsd,.015);
});

test('Google public cutover closes three old AI HTTP routes while saved SUMIF checks, hints and PPTX remain usable',async t=>{
  let providerCalls=0;
  const lessonOutput={supported:true,reason:'',title:'SUMIF',summary:'Add matching revenue.',evidence:[{anchorId:'sumif-purpose'},{anchorId:'sumif-arguments'}],
    slides:[0,1,2,3].map(i=>({title:`Step ${i+1}`,body:'Match the region and add revenue.',bullets:['Use matching rows.'],code:'',sourceAnchorId:i?'sumif-arguments':'sumif-purpose'}))};
  const learningService=createLearningService({env:{AI_PROVIDER:'gemini',GEMINI_API_KEY:'test-only-key',GEMINI_MODEL:env.GEMINI_MODEL,LEARNING_SIGNING_KEY_BASE64:env.LEARNING_SIGNING_KEY_BASE64},
    generationGate:{reason:()=>null,reserve:()=>null,observeResponse:()=>null},
    fetchImpl:async()=>{providerCalls++;return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(lessonOutput)}]}}]}),{status:200});}});
  const saved=await learningService.generate({source:{videoUrl:'https://www.youtube.com/watch?v=dI8w0utjUc0',start:35,end:186}});providerCalls=0;
  const {request}=await setup(t,{LEARNING_SIGNING_KEY:'local-only',GEMINI_MODEL:env.GEMINI_MODEL},{accounts:accountBoundary(),serverOptions:{studyAccessMode:'google',learningService,
    service:{readiness:()=>({configured:true}),recommend:async()=>{providerCalls++;return {}; }},
    mapService:{readiness:()=>({configured:true}),classify:async()=>{providerCalls++;return {}; }}}});
  for(const route of ['/api/learning/generate','/api/recommendations','/api/map/classify']){
    const response=await request(route,{method:'POST',body:{},headers:{authorization:'Bearer alice-token'}});
    assert.equal(response.status,409,route);assert.equal(response.json.error,'study_account_route_required');
  }
  const hint=await request('/api/learning/reteach',{method:'POST',body:{lessonToken:saved.lessonToken,formula:'=SUMIF(A2:A5,"Hong Kong",B2:B5)'}});
  assert.equal(hint.status,200);assert.equal(hint.json.method,'rule-based');assert.equal(hint.json.lessonId,saved.lesson.id);
  assert.deepEqual(hint.json.steps,[
    'Find the rows in A2:A5 that equal "Tokyo".',
    'Sum only column B values on those same rows. Both ranges must have the same size.',
    'Use "Tokyo" in double quotes, or use D2, then try again.',
  ]);
  assert.equal((await request('/api/learning/reteach',{method:'POST',body:{lessonToken:'forged',formula:'=SUMIF(A2:A5,D2,B2:B5)'}})).status,400);
  const checked=await request('/api/learning/validate',{method:'POST',body:{lessonToken:saved.lessonToken,formula:'=SUMIF(A2:A5,D2,B2:B5)'}});
  assert.equal(checked.status,200);assert.equal(checked.json.passed,true);assert.equal(checked.json.actualTotal,900);
  const exported=await request('/api/learning/pptx',{method:'POST',body:{lessonToken:saved.lessonToken}});
  assert.equal(exported.status,200);assert.equal(exported.buffer.subarray(0,2).toString(),'PK');assert.equal(providerCalls,0);
});

test('Firebase CSP allows only explicit authentication origins and legacy defaults stay unchanged',async t=>{
  const accounts=accountBoundary(),{request}=await setup(t,{LEARNING_SIGNING_KEY:'local-only',GEMINI_MODEL:env.GEMINI_MODEL},{accounts});
  const response=await request('auth-config'),csp=response.headers['content-security-policy'];
  assert.match(csp,/script-src 'self' https:\/\/apis\.google\.com;/);
  assert.match(csp,/frame-src https:\/\/www\.youtube\.com https:\/\/www\.youtube-nocookie\.com https:\/\/study\.test;/);
  assert.match(csp,/connect-src 'self' https:\/\/identitytoolkit\.googleapis\.com https:\/\/securetoken\.googleapis\.com;/);
  assert.ok(!csp.includes('unsafe-eval')&&!csp.includes('*'));
  const preflight=await request('generate',{method:'OPTIONS'});assert.match(preflight.headers['access-control-allow-headers'],/Authorization/);
  const local=await setup(t,{LEARNING_SIGNING_KEY:'local-only',GEMINI_MODEL:env.GEMINI_MODEL});
  const old=await local.request('catalogue',{headers:{host:'localhost',origin:'http://localhost'}});
  assert.ok(!old.headers['content-security-policy'].includes('apis.google.com'));
  for(const domain of ['study.test; script-src *','https://study.test','study.test/path','*.study.test','study.test:443','127.0.0.1']){
    assert.throws(()=>createServer({studyAccounts:{config:()=>({enabled:true,firebase:{authDomain:domain}})}}),{code:'firebase_configuration_invalid'});
  }
});
