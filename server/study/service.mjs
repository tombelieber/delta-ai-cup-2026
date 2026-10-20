import {createHash,randomUUID} from 'node:crypto';
import {parseStudySource,requireStudy,StudyError} from './source.mjs';
import {validateStudyLesson,publicStudyLesson,resolveStudyCitations} from './contract.mjs';
import {createStudyState} from './state.mjs';
import {STUDY_PROMPT_VERSION} from './provider.mjs';
import {studyPptx} from './pptx.mjs';
import {createStudyAccess,studySigningKey} from './access.mjs';
import {sanitizeStudyDiagnostics} from './diagnostics.mjs';
import {PROJECT_BUDGET_ENFORCED} from './project-budget.mjs';
import {retrieveStudyContext} from './retrieval.mjs';

export function createStudyService({directory,sources=[],provider,userQuota,paidUsage,env=process.env,now=Date.now}={}){
  requireStudy(env.GEMINI_PAID_BUDGET_APPROVED !== 'true' || env.STUDY_ACCESS_MODE === 'google'
    && userQuota?.[PROJECT_BUDGET_ENFORCED] === true, 'project_budget_configuration_invalid',503,
  'Paid AI requires Google authentication and the durable project budget.');
  const secret=studySigningKey(env),access=createStudyAccess({env,key:secret});
  requireStudy(access.mode!=='google'||typeof userQuota?.forUser==='function','credit_ledger_unavailable',503);
  const state=createStudyState({directory,key:secret,now});const locks=new Map(),downloads=new Map(),sourceList=Promise.resolve(sources);
  async function exclusive(key,operation){const previous=locks.get(key)||Promise.resolve();const next=previous.catch(()=>{}).then(operation);locks.set(key,next);try{return await next;}finally{if(locks.get(key)===next)locks.delete(key);}}
  function principalUid(context){
    if(access.mode!=='google')return null;
    const uid=context?.principal?.uid;
    requireStudy(typeof uid==='string'&&uid.length>0&&uid.length<=128,'authentication_required',401);
    return uid;
  }
  function openOwned(token,uid){return state.open(token,access.mode==='google'?{ownerUid:uid}:undefined);}
  function fundingLedger(funding){requireStudy(funding==='free'||funding==='paid','invalid_funding');requireStudy(funding!=='paid'||access.mode==='google'&&paidUsage?.[PROJECT_BUDGET_ENFORCED]===true,'payments_unavailable',503);return funding==='paid'?paidUsage:userQuota;}
  async function sessionCost(key,uid,funding='free'){
    const account=fundingLedger(funding).forUser(uid);
    requireStudy(typeof account.session==='function','credit_ledger_unavailable',503);
    const session=await account.session(key);
    requireStudy(typeof session?.available==='boolean','credit_ledger_invalid',503);
    if(!session.available)return {available:false,conservativeUsd:null,reservedUsd:null,spentUsd:null,limitUsd:.1,entries:[],detailsAvailable:false};
    requireStudy(['conservativeUsd','reservedUsd','spentUsd'].every(field=>Number.isFinite(session[field])&&session[field]>=0)&&session.limitUsd===.1&&
      Math.abs(session.conservativeUsd-session.reservedUsd-session.spentUsd)<1e-9,'credit_ledger_invalid',503);
    return {...session,entries:[],detailsAvailable:false};
  }
  function requireAffordableSession(cost,required=false){
    requireStudy(!required||cost.available,'session_budget_unavailable',409,'This session’s cost history could not be verified. Saved lessons, practice and exports remain available.');
    requireStudy(!cost.available||cost.conservativeUsd<cost.limitUsd,'video_budget_exceeded',429,'This video has reached its US$0.10 generation budget. Saved results remain available.');
  }
  function operationBudget(key,uid,{requireSession=false,funding='free',questionId=null}={}){
    const local=state.budget(key,{enforceLimit:access.mode!=='google'});
    if(access.mode!=='google')return {...local,preflight:async()=>{}};
    const account=fundingLedger(funding).forUser(uid,{questionId}),operationId=randomUUID();
    return {...local,
      async preflight(){requireAffordableSession(await sessionCost(key,uid,funding),requireSession);await account.check();},
      value:()=>sessionCost(key,uid,funding),
      async reserve(amount){
        await local.check(amount);
        const reservation=await account.reserve({operationId,sessionId:key,amountUsd:amount});
        requireStudy(reservation?.created===true,'credit_operation_conflict',409);
        try{await local.reserve(amount);}catch(error){await account.settle({operationId,actualUsd:0});throw error;}
      },
      async settle(amount,usage){await account.settle({operationId,actualUsd:amount,usage});await local.settle(amount,usage);requireAffordableSession(await sessionCost(key,uid,funding),true);},
      async failure(diagnostics){try{await account.failure({operationId,diagnostics});}finally{await local.failure(diagnostics);}},
    };
  }
  const profileFor=value=>{
    const p={level:value?.level||'beginner',language:value?.language||'en',interests:value?.interests||[]};
    requireStudy(['beginner','some-experience'].includes(p.level)&&['en','zh-HK'].includes(p.language)&&Array.isArray(p.interests)&&p.interests.length<=5&&p.interests.every(x=>typeof x==='string'&&x.trim()&&x.length<=80),'invalid_profile');
    return {...p,interests:[...new Set(p.interests.map(x=>x.trim()))]};};
  const publicSource=source=>({...source,anchors:source.anchors.map(({text,...a})=>a)});
  const visible=lesson=>publicStudyLesson({...lesson,source:publicSource(lesson.source)});
  function memoryLessons(input,uid){requireStudy(Array.isArray(input||[])&&(input||[]).length<=8,'invalid_memory');return (input||[]).map(item=>{
    const lesson=openOwned(item.lessonToken,uid);requireStudy(Array.isArray(item.feedbackTokens||[])&&(item.feedbackTokens||[]).length<=10,'invalid_memory');
    const attempts=(item.feedbackTokens||[]).map(token=>openOwned(token,uid).feedback);
    requireStudy(attempts.every(a=>a?.lessonId===lesson.id&&a.method==='ai-authored-key-match'&&lesson.exercises.some(e=>e.id===a.taskId)),'invalid_practice_evidence');
    return {...lesson,practiceEvidence:attempts};});}
  async function result(lesson,lessonToken,cached,uid){
    const cost=access.mode==='google'?await sessionCost(lesson.costKey,uid,lesson.funding||'free'):access.mode!=='local'&&!await state.read(lesson.costKey,'cost')?
      {available:false,conservativeUsd:null,entries:[]}:await state.budget(lesson.costKey).value();
    return {lesson:visible(lesson),lessonToken,cached,cost};}
  function findTask(input,uid){const lesson=openOwned(input.lessonToken,uid),task=lesson.exercises.find(e=>e.id===input.taskId);requireStudy(task,'invalid_task_id');return {lesson,task};}
  return {
    access,
    async catalogue(context){principalUid(context);return {sources:(await sourceList).map(publicSource),storage:'browser-local',model:env.GEMINI_MODEL,maxVideoUsd:.1};},
    async generate(input,context){
      const uid=principalUid(context);
      requireStudy(input&&typeof input==='object','invalid_request');const funding=input.funding||'free';fundingLedger(funding);const profile=profileFor(input.profile);
      const source=input.transcript?parseStudySource({videoId:input.videoId,title:input.title,text:input.transcript,start:input.start,end:input.end}):(await sourceList).find(s=>s.videoId===input.videoId);
      requireStudy(source,'source_unavailable',422,'Import timestamped captions for this video before generating a lesson.');
      const prior=memoryLessons(input.memory,uid).flatMap(l=>l.concepts.map(c=>({id:c.id,label:c.label,explanation:c.explanation,
        status:l.practiceEvidence.some(a=>a.passed&&c.anchorIds.includes(l.exercises.find(e=>e.id===a.taskId)?.anchorId))?'exercise-key-matched-not-mastery':'previously-generated-not-mastery'}))).slice(-12);
      const key=createHash('sha256').update(JSON.stringify({digest:source.digest,profile,prior,version:STUDY_PROMPT_VERSION,model:env.GEMINI_MODEL,...(uid?{ownerUid:uid}:{}),...(funding==='paid'?{funding}:{} )})).digest('hex');
      return exclusive(key,async()=>{
        if(funding==='paid'){const paid=await paidUsage.begin(uid,key);if(paid.lessonToken)return result(openOwned(paid.lessonToken,uid),paid.lessonToken,true,uid);}
        try{
        const cached=funding==='free'?await state.read(key,'lesson'):null;
        if(cached){try{const lesson=openOwned(cached.lessonToken,uid);return result(lesson,cached.lessonToken,true,uid);}catch(e){if(e.code!=='expired_lesson')throw e;}}
        const budget=operationBudget(key,uid,{funding});let generated;
        await budget.preflight();
        await state.write(key,'meta',{videoId:source.videoId,model:env.GEMINI_MODEL,sourceDigest:source.digest,promptVersion:STUDY_PROMPT_VERSION});
        // A format-only correction is deliberately not automatic in this
        // prototype: failures retain cost and cannot silently consume quota.
        const raw=await provider.generate({source,profile,prior,budget});
        try{generated=validateStudyLesson(raw,source);}
        catch(error){
          // Usage was already settled. Diagnostic persistence cannot refund it,
          // replace the contract error, or turn an invalid output into a lesson.
          try{await budget.failure?.(sanitizeStudyDiagnostics(error?.diagnostics));}catch{}
          throw error;
        }
        const lesson={...generated,id:randomUUID(),...(uid?{ownerUid:uid}:{}),source,profile,...(funding==='paid'?{funding}:{}),costKey:key,createdAt:new Date(now()).toISOString(),model:env.GEMINI_MODEL,
          priorConcepts:prior.map(({id,label,status})=>({id,label,status})),assessment:'ai-authored-key-match',limitations:['Captions may contain errors; teaching material is AI-generated and not independently verified.','New exercise scenarios are created by Delta. Matching an AI-authored key does not establish mastery.',funding==='paid'?'Your library stays in this browser. Encrypted paid-result receipts are retained on the server to recover purchased results; selected context is sent to Gemini.':'Saved learning stays in this browser. Only selected context is sent to Gemini; no cloud memory database is used.']};
        const lessonToken=state.seal(lesson);if(funding==='paid')await paidUsage.finish(uid,key,lessonToken);await state.write(key,'lesson',{lessonToken});return result(lesson,lessonToken,false,uid);
        }catch(error){if(funding==='paid'){try{await paidUsage.fail(uid,key);}catch{}}throw error;}
      });
    },
    async answer(input,context){const uid=principalUid(context),{lesson,task}=findTask(input,uid);requireStudy(Number.isInteger(input.choice)&&input.choice>=0&&input.choice<task.options.length,'invalid_answer');
      const passed=input.choice===task.correctIndex;const feedback={lessonId:lesson.id,taskId:task.id,choice:input.choice,passed,message:passed?task.explanation:'This choice does not match the exercise key. Use the hint and review the source.',hint:passed?'':task.hint,
        sourceUrl:`${lesson.source.videoUrl}&t=${task.sourceTime}s`,method:'ai-authored-key-match',checkedAt:new Date(now()).toISOString()};
      return {...feedback,feedbackToken:state.seal({id:`attempt:${randomUUID()}`,...(uid?{ownerUid:uid}:{}),feedback})};},
    async ask(input,context){const uid=principalUid(context),primary=openOwned(input.lessonToken,uid);requireStudy(typeof input.question==='string'&&input.question.trim()&&input.question.length<=500,'invalid_question');
      // Retrieval happens over the caller's supplied saved capabilities. There
      // is no server-wide private library or caller-chosen cloud store. Resolve
      // citations against the same canonical versions used for caption recall.
      const {memories,sources:recallSources}=retrieveStudyContext({question:input.question,primary,memory:memoryLessons(input.memory,uid)});
      return exclusive(primary.costKey,async()=>{
        requireStudy(access.mode!=='guarded'||await state.read(primary.costKey,'cost'),'session_budget_unavailable',409,
          'This session’s cost receipt is unavailable. Saved lessons, practice and exports remain available.');
        const funding=primary.funding||'free',questionId=funding==='paid'?paidUsage.questionKey(JSON.stringify({question:input.question.trim(),memories})):null;
        if(questionId){const saved=await paidUsage.question(uid,primary.costKey,questionId);if(saved.answerToken){const savedAnswer=openOwned(saved.answerToken,uid).answer;return {...savedAnswer,cached:true,cost:await sessionCost(primary.costKey,uid,funding)};}}
        try{
        const budget=operationBudget(primary.costKey,uid,{requireSession:true,funding,questionId});await budget.preflight();
        const answer=await provider.ask({question:input.question.trim(),memories,budget});
        requireStudy(typeof answer?.answer==='string'&&answer.answer.trim()&&answer.answer.length<=3000,'invalid_provider_output',502);
        const allowed=new Set(memories.map(m=>`${m.videoId}:${m.anchorId}`));
        requireStudy(Array.isArray(answer.citations)&&answer.citations.every(c=>allowed.has(`${c.videoId}:${c.anchorId}`)),'invalid_citation',502);
        const citations=answer.citations.length?resolveStudyCitations(answer.citations,recallSources):[];
        const response={answer:citations.length?answer.answer:'I could not find that in your saved learning sources.',citations,method:'local-caption-retrieval-gemini',cost:await budget.value()};
        if(questionId)await paidUsage.finishQuestion(uid,primary.costKey,questionId,state.seal({id:`answer:${randomUUID()}`,ownerUid:uid,answer:response}));
        return response;
        }catch(error){if(questionId){try{await paidUsage.failQuestion(uid,primary.costKey,questionId);}catch{}}throw error;}
      });
    },
    async exportPptx(input,context){return studyPptx(openOwned(input.lessonToken,principalUid(context)));},
    async preparePptx(input,context){
      const uid=principalUid(context),file=await studyPptx(openOwned(input.lessonToken,uid));
      for(const [id,item] of downloads)if(item.expiresAt<=now())downloads.delete(id);
      while(downloads.size>=8)downloads.delete(downloads.keys().next().value);
      requireStudy(file.buffer.length<2000000,'export_too_large',413);
      const id=randomUUID();downloads.set(id,{file,ownerUid:uid,expiresAt:now()+90000});
      return {id,url:`/api/study/download/${id}`,filename:file.filename,expiresInSeconds:90};
    },
    async downloadPptx(id,context){const uid=principalUid(context),entry=downloads.get(id);requireStudy(entry&&entry.expiresAt>now(),'download_expired',404,'This local download link expired. Prepare the PowerPoint again without another AI request.');requireStudy(access.mode!=='google'||entry.ownerUid===uid,'lesson_access_denied',403);return entry.file;},
    async inspect(input,context){const uid=principalUid(context),lesson=openOwned(input.lessonToken,uid);return result(lesson,input.lessonToken,true,uid);},
  };
}
