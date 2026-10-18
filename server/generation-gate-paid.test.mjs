import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenerationGate} from './generation-gate.mjs';
import {createStudyProvider} from './study/provider.mjs';
import {createGeminiProvider} from './gemini.mjs';

const keyResource='projects/2937676390/locations/global/keys/c8631e91-1d44-4033-a5b6-1857223f4778';
const paidEnv=()=>({AI_PROVIDER:'gemini',GEMINI_MODEL:'gemini-3.8-flash',GEMINI_API_KEY:'synthetic-key',
  GEMINI_API_PROJECT:'gen-lang-client-0441267635',GEMINI_API_KEY_RESOURCE:keyResource,
  GEMINI_FREE_TIER_ONLY:'false',GEMINI_PAID_BUDGET_APPROVED:'true',STUDY_PROJECT_BUDGET_USD:'10'});
const metered={transport:'gemini',model:'gemini-3.8-flash',scope:'metered-study'};

test('approved paid inference requires the trusted metered-study scope on both checks and reservations',()=>{
  const gate=createGenerationGate({env:paidEnv()});
  for(const context of [undefined,{}, {scope:'legacy'}, {scope:'metered-study-unknown'},
    {transport:'gemini',model:'gemini-3.8-flash'}]){
    assert.equal(gate.reason(context),'metered_route_required');
    assert.equal(gate.reserve(context).reason,'metered_route_required');
  }
  assert.equal(gate.reason(metered),null);assert.equal(gate.reserve(metered),null);
});

test('paid authorization requires exact flags, budget, Gemini model, project, key resource and transport',()=>{
  for(const change of [
    {GEMINI_PAID_BUDGET_APPROVED:undefined},{GEMINI_PAID_BUDGET_APPROVED:'false'},
    {STUDY_PROJECT_BUDGET_USD:undefined},{STUDY_PROJECT_BUDGET_USD:'10.00'},
    {STUDY_PROJECT_BUDGET_USD:'100'},{STUDY_PROJECT_BUDGET_USD:10},
    {GEMINI_FREE_TIER_ONLY:undefined},{GEMINI_FREE_TIER_ONLY:'FALSE'},
    {GEMINI_FREE_TIER_ONLY:'true'},{AI_PROVIDER:'vertex'},{GEMINI_MODEL:'gemini-2.5-flash'},
    {GEMINI_API_PROJECT:'different-project'}, {GEMINI_API_KEY_RESOURCE:undefined},
    {GEMINI_API_KEY_RESOURCE:'projects/2937676390/locations/global/keys/00000000-0000-4000-8000-000000000000'},
  ]) {
    const gate=createGenerationGate({env:{...paidEnv(),...change}});
    assert.equal(gate.reason(metered),'paid_route_not_verified',JSON.stringify(change));
    assert.equal(gate.reserve(metered).reason,'paid_route_not_verified');
  }
  for(const context of [{...metered,transport:'vertex'},{...metered,model:'gemini-2.5-flash'}])
    assert.equal(createGenerationGate({env:paidEnv()}).reason(context),'paid_route_not_verified');
});

test('a false free-only flag without complete paid authorization never opens arbitrary provider traffic',()=>{
  for(const env of [{GEMINI_FREE_TIER_ONLY:'false'}, {GEMINI_FREE_TIER_ONLY:'unknown'},
    {GEMINI_PAID_BUDGET_APPROVED:'false'}, {STUDY_PROJECT_BUDGET_USD:'10'}])
    assert.equal(createGenerationGate({env}).reserve(metered).reason,'paid_route_not_verified');
  // Existing local/provider configurations with none of the new policy flags
  // retain their behavior; production paid admission never uses this branch.
  assert.equal(createGenerationGate({env:{AI_PROVIDER:'gemini'}}).reserve(),null);
});

test('paid mode does not invent free-tier process limits but retains global pause and provider backoff',()=>{
  let time=1000000;
  const gate=createGenerationGate({env:paidEnv(),now:()=>time});
  for(let i=0;i<30;i++)assert.equal(gate.reserve(metered),null);
  assert.equal(Object.hasOwn(gate.status(),'requestsPerMinute'),false);
  assert.equal(Object.hasOwn(gate.status(),'requestsPerPacificDay'),false);
  assert.equal(gate.status().projectBudgetUsd,10);
  assert.equal(gate.observeResponse(429,'90').reason,'free_tier_quota_exhausted');
  assert.equal(gate.reserve(metered).retryAfterSeconds,90);
  time+=90000;assert.equal(gate.reserve(metered),null);
  assert.equal(gate.observeResponse(402).reason,'provider_billing_required');
  assert.equal(gate.reserve(metered).reason,'provider_billing_required');
  assert.equal(createGenerationGate({env:{...paidEnv(),AI_GENERATION_DISABLED:'true'}}).reason(metered),'generation_disabled');
  assert.equal(createGenerationGate({env:{...paidEnv(),GEMINI_BILLING_PAUSED:'true'}}).reason(metered),'provider_billing_required');
});

test('legacy Gemini providers cannot dispatch or report configured in an otherwise approved paid environment',async()=>{
  let calls=0;
  const env=paidEnv(),gate=createGenerationGate({env});
  const legacy=createGeminiProvider({env,generationGate:gate,fetchImpl:async()=>{calls++;throw Error('must not dispatch');}});
  assert.equal(legacy.configured,false);assert.equal(legacy.reason,'metered_route_required');
  await assert.rejects(legacy.choose({memory:[],candidates:[]}),{code:'metered_route_required'});
  assert.equal(calls,0);
});

test('the scoped StudyProvider waits for durable dollar reservation before generation; countTokens is non-inference',async()=>{
  const env=paidEnv(),events=[];
  let releaseReservation,enteredReservation;
  const reserved=new Promise(resolve=>{enteredReservation=resolve;});
  const pendingReservation=new Promise(resolve=>{releaseReservation=resolve;});
  const provider=createStudyProvider({env,generationGate:createGenerationGate({env}),fetchImpl:async(url)=>{
    if(url.endsWith(':countTokens')){events.push('countTokens');return new Response('{"totalTokens":1000}');}
    events.push('generateContent');
    return new Response(JSON.stringify({usageMetadata:{promptTokenCount:1000,candidatesTokenCount:20},
      candidates:[{finishReason:'STOP',content:{parts:[{text:'{"answer":"Saved source answer.","citations":[]}'}]}}]}));
  }});
  const pending=provider.ask({question:'Saved sources?',memories:[],budget:{
    async reserve(amount){assert.ok(amount>0&&amount<.1);events.push('reserve');enteredReservation();await pendingReservation;},
    async settle(amount){assert.equal(amount,.00165);events.push('settle');},
  }});
  await reserved;assert.deepEqual(events,['countTokens','reserve']);
  releaseReservation();assert.equal((await pending).answer,'Saved source answer.');
  assert.deepEqual(events,['countTokens','reserve','generateContent','settle']);
});

test('a failed durable reservation stops paid generation without a provider retry or model fallback',async()=>{
  const env=paidEnv();let count=0,generation=0;
  const provider=createStudyProvider({env,generationGate:createGenerationGate({env}),fetchImpl:async url=>{
    if(url.endsWith(':countTokens')){count++;return new Response('{"totalTokens":1000}');}
    generation++;throw Error('must not dispatch');
  }});
  const exhausted=Object.assign(Error('Project budget exhausted'),{code:'project_budget_exhausted',status:402});
  await assert.rejects(provider.ask({question:'Saved sources?',memories:[],budget:{reserve:async()=>{throw exhausted;}}}),exhausted);
  assert.equal(count,1);assert.equal(generation,0);
});
