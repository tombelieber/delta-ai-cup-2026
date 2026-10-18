#!/usr/bin/env node
// No provider credentials or AI calls: real local routes, isolated test state.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {createServer} from '../../server/index.mjs';
import {loadStudySources} from '../../server/study/catalogue.mjs';
import {STUDY_PROMPT_VERSION} from '../../server/study/provider.mjs';
import {createStudyService} from '../../server/study/service.mjs';
import {createStudyState} from '../../server/study/state.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const OUTPUT=path.join(ROOT,'artifacts/study/benchmark');
const TOPICS=['SUMIF','Finance','Accounting','IELTS'];
const sha256=value=>createHash('sha256').update(value).digest('hex');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const round=value=>Number(value.toFixed(3));
const inputHash=async file=>sha256(await readFile(path.join(ROOT,file)));
const relative=file=>path.relative(ROOT,file).split(path.sep).join('/');

function argumentsFor(argv){
  let samples=5;
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--samples')samples=Number(argv[++i]);
    else throw new Error('Usage: node tools/benchmark/study-benchmark.mjs [--samples 1..5]');
  }
  assert(Number.isInteger(samples)&&samples>=1&&samples<=5,'Use 1..5 samples to bound requests below the default local rate limit.');
  return {samples};
}

function statistics(samples){
  const sorted=samples.map(s=>s.milliseconds).sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return {samples:sorted.length,minMs:sorted[0],medianMs:round(sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2),maxMs:sorted.at(-1)};
}

async function snapshot(directory){
  return Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async file=>[file,sha256(await readFile(path.join(directory,file)))])));
}

async function auditCosts(outputs){
  const rows=[];
  for(const {topic,lesson,cost} of outputs){
    const stored=await json(path.join(ROOT,`artifacts/study/cache/${lesson.costKey}.cost.json`));
    assert.deepEqual(stored,cost,`${topic}: saved output and durable budget receipt differ.`);
    const cumulative=Number(cost.entries.reduce((sum,e)=>sum+(e.actualUsd??e.reservedUsd),0).toFixed(9));
    assert.equal(cumulative,cost.conservativeUsd);
    assert(cumulative<.1);
    const entries=cost.entries.map((entry,index)=>({
      ordinal:index+1,operation:topic==='SUMIF'&&index>0?'memory-answer':'lesson-generation',
      state:entry.actualUsd===null?'retained-reservation-usage-unknown':'settled-with-usage',
      reservedUsd:entry.reservedUsd,settledEstimateUsd:entry.actualUsd,
      usage:entry.usage||{usageKnown:false},...(entry.failure?{failure:entry.failure}:{}),
    }));
    rows.push({topic,conservativeUsd:cumulative,recordedAttempts:entries.length,unknownUsageAttempts:entries.filter(e=>!e.usage.usageKnown).length,
      inputs:{outputSha256:await inputHash(`artifacts/study/outputs/Delta-${topic}.json`),budgetReceiptSha256:await inputHash(`artifacts/study/cache/${lesson.costKey}.cost.json`)},entries});
  }
  const all=rows.flatMap(r=>r.entries),lesson=all.filter(e=>e.operation==='lesson-generation'),memory=all.filter(e=>e.operation==='memory-answer');
  const rate=entries=>({successfulWithUsage:entries.filter(e=>e.state==='settled-with-usage').length,recordedAttempts:entries.length});
  const result={schemaVersion:1,scope:'Historical saved generation budget receipts; not an invoice or a content-quality assessment.',
    attribution:'Operation attribution follows docs/verification-four-video-study-2026-10-18.md and saved SUMIF entry ordering; the earlier IELTS failure has no retained provider status.',
    historicalGenerationLatency:'unknown; no per-attempt start/end or elapsed duration is retained',
    priceBasis:{usdPerMillionInputTokens:1.5,usdPerMillionOutputTokens:7.5,outputIncludesReportedThinking:true,source:'server/study/provider.mjs pinned conservative estimate; not a live price quote'},
    totalConservativeUsd:Number(rows.reduce((sum,r)=>sum+r.conservativeUsd,0).toFixed(9)),lesson:rate(lesson),memory:rate(memory),combined:rate(all),rows};
  await writeFile(path.join(OUTPUT,'cost-audit.json'),JSON.stringify(result,null,2)+'\n');
  return result;
}

async function main(){
  const {samples}=argumentsFor(process.argv.slice(2));
  const startedAt=new Date().toISOString(),wallStart=performance.now();
  await mkdir(OUTPUT,{recursive:true,mode:0o700});
  const outputs=await Promise.all(TOPICS.map(async topic=>({topic,...await json(path.join(ROOT,`artifacts/study/outputs/Delta-${topic}.json`))})));
  const historical=await auditCosts(outputs);
  const sources=await loadStudySources(path.join(ROOT,'artifacts/study/sources'));
  assert.equal(sources.length,4,'All four matching prepared caption files are required; no transcript is downloaded.');
  const scratch=path.join(OUTPUT,`.scratch-${process.pid}-${Date.now()}`);
  const env={LEARNING_SIGNING_KEY:'isolated-benchmark-fixture-key-not-a-provider-key',GEMINI_MODEL:outputs[0].lesson.model};
  const state=createStudyState({directory:scratch,key:env.LEARNING_SIGNING_KEY});
  const fixtures=[];
  const concepts=new Map(outputs.flatMap(({lesson})=>lesson.concepts.map(c=>[c.id,c])));
  let server;
  try{
    for(const {topic,lesson,cost} of outputs){
      const source=sources.find(s=>s.videoId===lesson.source.videoId);
      assert.equal(source?.digest,lesson.source.digest,`${topic}: captions differ from the generated output.`);
      assert.equal(lesson.slides.length,4);assert.equal(lesson.exercises.length,2);
      assert.equal(lesson.model,env.GEMINI_MODEL);
      const prior=lesson.priorConcepts.map(({id,label,status})=>{
        assert(concepts.has(id),`${topic}: a prior concept is missing from the local outputs.`);
        return {id,label,explanation:concepts.get(id).explanation,status};
      });
      const key=sha256(JSON.stringify({digest:source.digest,profile:lesson.profile,prior,version:STUDY_PROMPT_VERSION,model:lesson.model}));
      assert.equal(key,lesson.costKey,`${topic}: current cache contract differs from the historical output.`);
      // Public exports intentionally omit private keys. Synthetic keys make
      // feedback timing reproducible; they do not assess the saved exercises.
      const fixture={...lesson,id:`benchmark-fixture-${topic.toLowerCase()}`,source,
        exercises:lesson.exercises.map(e=>({...e,correctIndex:0,explanation:'Synthetic benchmark key; no content assessment.',hint:'Synthetic benchmark hint.'}))};
      const lessonToken=state.seal(fixture);
      await state.write(key,'lesson',{lessonToken});await state.write(key,'cost',cost);
      fixtures.push({topic,lesson:fixture,lessonToken});
    }
    const boundary={generateCalls:0,retrievalStubCalls:0,externalInferenceCalls:0};
    let retrievalShape;
    const provider={
      async generate(){boundary.generateCalls++;throw new Error('Inference is prohibited in this benchmark.');},
      async ask({memories}){
        boundary.retrievalStubCalls++;
        assert(memories.length>0&&memories.length<=16);
        const shape={selectedAnchors:memories.length,selectedTextCharacters:memories.reduce((n,m)=>n+m.text.length,0),
          orderedAnchorDigest:sha256(JSON.stringify(memories.map(m=>[m.videoId,m.anchorId])))};
        if(retrievalShape)assert.deepEqual(shape,retrievalShape,'Retrieval ranking changed across samples.');else retrievalShape=shape;
        return {answer:'Synthetic retrieval-boundary response; no model called.',citations:[{videoId:memories[0].videoId,anchorId:memories[0].anchorId}]};
      },
    };
    const studyService=createStudyService({directory:scratch,sources,provider,env});
    // Inject inert unrelated services: no default provider is configured/read.
    server=createServer({studyService,service:{readiness:async()=>({configured:false})},learningService:{readiness:()=>({configured:false})},
      mapService:{readiness:()=>({configured:false})},mapAccess:{configured:false}});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin=`http://127.0.0.1:${server.address().port}`;
    const primary=fixtures[0],memory=fixtures.slice(1).map(f=>({lessonToken:f.lessonToken,feedbackTokens:[]}));
    const operations=[
      {id:'cached-lesson-http',route:'generate',input:{videoId:primary.lesson.source.videoId,profile:primary.lesson.profile,memory},
        check:value=>{assert.equal(value.cached,true);assert.equal(value.lesson.id,primary.lesson.id);}},
      {id:'deterministic-feedback-http',route:'answer',input:{lessonToken:primary.lessonToken,taskId:primary.lesson.exercises[0].id,choice:0},
        check:value=>{assert.equal(value.passed,true);assert.equal(value.method,'ai-authored-key-match');}},
      {id:'caption-retrieval-with-stub-http',route:'ask',input:{lessonToken:primary.lessonToken,memory,question:'How can a business show profit but still not have cash?'},
        check:value=>{assert.equal(value.citations.length,1);assert.equal(value.answer,'Synthetic retrieval-boundary response; no model called.');}},
      {id:'pptx-export-http',route:'pptx',input:{lessonToken:primary.lessonToken},binary:true,
        check:value=>assert.equal(value.subarray(0,4).toString('hex'),'504b0304')},
    ];
    const before=await snapshot(scratch),measurements=[];
    for(const operation of operations){
      const measured=[];let warmup;
      const payload=JSON.stringify(operation.input);
      for(let index=-1;index<samples;index++){
        const start=performance.now();
        const response=await fetch(`${origin}/api/study/${operation.route}`,{method:'POST',headers:{'content-type':'application/json'},body:payload,signal:AbortSignal.timeout(15000),redirect:'error'});
        const bytes=Buffer.from(await response.arrayBuffer());
        const value=operation.binary?bytes:JSON.parse(bytes.toString('utf8'));
        const milliseconds=round(performance.now()-start);
        assert.equal(response.status,200,`${operation.id}: request ${index} failed.`);operation.check(value);
        const sample={index:index+1,milliseconds,httpStatus:response.status,responseBytes:bytes.length};
        if(index===-1)warmup=sample;else measured.push(sample);
        if(operation.binary&&index===0)await writeFile(path.join(OUTPUT,'synthetic-key-benchmark-fixture.pptx'),bytes);
      }
      measurements.push({id:operation.id,route:`POST /api/study/${operation.route}`,warmup,summary:statistics(measured),attempts:measured});
    }
    const after=await snapshot(scratch);
    assert.deepEqual(after,before,'Measured requests must not mutate seeded lesson or budget files.');
    assert.equal(boundary.generateCalls,0);assert.equal(boundary.retrievalStubCalls,samples+1);
    const implementationFiles=['server/index.mjs','server/study/service.mjs','server/study/router.mjs','server/study/state.mjs','server/study/source.mjs','server/study/catalogue.mjs','server/study/contract.mjs','server/study/pptx.mjs','server/study/provider.mjs','tools/benchmark/study-benchmark.mjs'];
    const implementationSha256=Object.fromEntries(await Promise.all(implementationFiles.map(async file=>[file,await inputHash(file)])));
    const report={schemaVersion:1,startedAt,finishedAt:new Date().toISOString(),totalElapsedMs:round(performance.now()-wallStart),
      headCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),implementationSha256,
      environment:{node:process.version,platform:os.platform(),architecture:os.arch(),osRelease:os.release(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryGiB:round(os.totalmem()/1024**3)},
      contract:{surface:'Current application HTTP handler and study service on a fresh isolated loopback listener; not the owner live process or browser.',
        timing:'Client wall-clock from fetch dispatch through full response-body read and JSON parse. Assertions are excluded.',
        iterations:samples,warmupsPerOperation:1,httpRequests:operations.length*(samples+1),concurrency:1,
        fixtures:'Existing four generated public lessons plus matching local caption files; test-only encryption key and synthetic exercise answer metadata.',
        pptxFixture:'artifacts/study/benchmark/synthetic-key-benchmark-fixture.pptx contains synthetic answer metadata; it is NOT a historical product deck.',
        retrieval:'Authenticated local caption selection, ranking, request preparation, stub boundary, one citation resolution and HTTP overhead; excludes all Gemini inference and provider transport.',
        cache:'Preseeded valid local cache with historical selected prior concepts reconstructed from the saved outputs; provider.generate throws if invoked. Warm filesystem/process; excludes first generation and browser rendering.',
        requestMutation:'No seeded lesson/budget file changed. Temporary cache removed after completion. Only benchmark evidence written.',
        zeroInferenceEnforcement:'Provider implementation replaced by an in-process stub with no network calls; cache misses throw. No .env or existing encrypted capability is read.',
        inferenceCostUsd:0,concurrentLoad:'Other machine workloads uncontrolled; no throughput or deployment capacity claim.'},
      evidence:{historicalCostAudit:relative(path.join(OUTPUT,'cost-audit.json')),historicalRecordedGenerationAttempts:historical.combined.recordedAttempts,
        boundary,seededCacheUnchanged:true,fixtureSourceCount:sources.length,totalSourceAnchors:sources.reduce((n,s)=>n+s.anchors.length,0),retrievalShape},measurements};
    await writeFile(path.join(OUTPUT,'local-measurements.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({status:'completed',requests:report.contract.httpRequests,externalInferenceCalls:0,report:'artifacts/study/benchmark/local-measurements.json',measurements:measurements.map(m=>({id:m.id,...m.summary}))},null,2));
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await rm(scratch,{recursive:true,force:true});
  }
}

main().catch(error=>{console.error(`Benchmark stopped: ${error.message}`);process.exitCode=1;});
