import {StudyError,requireStudy} from './source.mjs';
import {createStudyAccess} from './access.mjs';
import {createStudyFailureDiagnostic} from './diagnostics.mjs';

const POST_ACTIONS=new Set(['generate','answer','ask','pptx','preparePptx','inspect','classify','registerImports']);
const DOWNLOAD=/^download\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function createUidAdmission({requestsPerMinute=60,maxConcurrent=2,maxUsers=500}={},now=Date.now){
  for(const [value,max] of [[requestsPerMinute,6000],[maxConcurrent,32],[maxUsers,5000]]){
    requireStudy(Number.isInteger(value)&&value>0&&value<=max,'study_admission_configuration_invalid',503);
  }
  const users=new Map(),windowMs=60000;
  return uid=>{
    const time=now();
    // Never evict active entries: that would reset their concurrency guard.
    for(const [key,entry] of users)if(entry.active===0&&time-entry.start>=windowMs)users.delete(key);
    let entry=users.get(uid);
    if(!entry){
      if(users.size>=maxUsers)return {error:'study_admission_full',seconds:60};
      entry={start:time,count:0,active:0};users.set(uid,entry);
    }
    if(entry.active>=maxConcurrent)return {error:'study_user_busy',seconds:1};
    if(time-entry.start>=windowMs){entry.start=time;entry.count=0;}
    if(++entry.count>requestsPerMinute)return {error:'study_user_rate_limited',seconds:Math.max(1,Math.ceil((entry.start+windowMs-time)/1000))};
    entry.active++;
    let released=false;
    return {release(){if(!released){released=true;entry.active--;}}};
  };
}

export function createStudyRouter(service,{accounts,entitlements,classificationService,admission,now=Date.now,onDiagnostic}={}){
  const access=service?.access||createStudyAccess();
  requireStudy(access.mode!=='google'||['authenticate','config','forUser'].every(name=>typeof accounts?.[name]==='function'),
    'firebase_configuration_invalid',503);
  const admitUser=createUidAdmission(admission,now);
  return async({request,response,url,json,readBody,rateAllowed})=>{
    if(!url.pathname.startsWith('/api/study/'))return false;
    if(!service){
      if(url.pathname==='/api/study/auth-config'&&request.method==='GET')json(200,{enabled:false,limitUsd:.5});
      else json(404,{error:'study_disabled',message:'The learning prototype is not enabled on this service.'});
      return true;
    }
    const action=url.pathname.slice('/api/study/'.length);
    const download=DOWNLOAD.test(action)&&request.method==='GET';
    const denied=access.check(request,{download});
    if(denied){json(denied.status,{error:denied.code,message:denied.message});return true;}
    if(action==='auth-config'&&request.method==='GET'){json(200,accounts?.config()||{enabled:false,limitUsd:.5});return true;}
    const method=POST_ACTIONS.has(action)?'POST':['session','catalogue','entitlements'].includes(action)||DOWNLOAD.test(action)?'GET':null;
    if(!method){json(404,{error:'not_found'});return true;}
    // This existing process-local peer limit is a cheap admission bound, not
    // an end-user IP identity behind Cloud Run. It must precede Firebase RPCs.
    if(!rateAllowed(request)){json(429,{error:'rate_limited',message:'Please wait before trying again.'},{'retry-after':'60'});return true;}
    const actionFailure=async(error,fallback='study_unavailable')=>{
      const event=createStudyFailureDiagnostic(download?'download':action,error);
      try{await onDiagnostic?.(event);}catch{} // Logging never replaces the actual failure.
      const reference=event.reference;
      if(error instanceof StudyError&&event.code===error.code)json(error.status,{error:error.code,reference,
        message:error.code==='invalid_provider_output'?'Gemini returned material that could not be verified. Your saved work is kept. No automatic retry was made.':error.message,
        ...(error.retryAfterSeconds?{retryAfterSeconds:error.retryAfterSeconds}:{})});
      else if(error?.status===413)json(413,{error:'body_too_large',reference});
      else json(503,{error:fallback,reference,message:'The learning step could not be completed. Your saved work is kept.'});
    };
    let principal,release;
    try{
      if(access.mode==='google'||['session','entitlements','registerImports'].includes(action)){
        try{
          requireStudy(typeof accounts?.authenticate==='function','authentication_required',401);
          principal=await accounts.authenticate(request);
          requireStudy(typeof principal?.uid==='string'&&principal.uid.length>0&&principal.uid.length<=128,'authentication_required',401);
          const admitted=admitUser(principal.uid);
          if(admitted.error){json(429,{error:admitted.error,message:'Please wait before trying again.'},{'retry-after':String(admitted.seconds)});return true;}
          release=admitted.release;
        }catch(error){json(error instanceof StudyError?error.status:503,{error:error instanceof StudyError?error.code:'study_auth_unavailable',message:error instanceof StudyError?error.message:'Sign-in is unavailable. Your saved learning is kept.'});return true;}
      }
      if(request.method!==method){json(405,{error:'method_not_allowed'},{allow:`${method}, OPTIONS`});return true;}
      if(action==='session'){
        try{json(200,{user:{uid:principal.uid},quota:await accounts.forUser(principal.uid).snapshot()});}
        catch(error){await actionFailure(error);}return true;
      }
      if(action==='entitlements'){
        try{
          requireStudy(typeof entitlements?.forUser==='function','import_ledger_unavailable',503,'Import allowance is unavailable. Saved records remain available.');
          json(200,await entitlements.forUser(principal.uid).snapshot());
        }catch(error){await actionFailure(error);}return true;
      }
      if(download){
        try{const file=await service.downloadPptx(action.slice('download/'.length),{principal});response.writeHead(200,{'content-type':file.contentType,'content-length':file.buffer.length,'cache-control':'no-store','content-disposition':`attachment; filename="${file.filename}"`});response.end(file.buffer);}
        catch(error){await actionFailure(error,'export_unavailable');}return true;
      }
      if(action==='catalogue'){
        try{json(200,await service.catalogue({principal}));}catch(error){await actionFailure(error);}return true;
      }
      if(request.headers['content-type']?.split(';')[0]?.trim()!=='application/json'){json(415,{error:'unsupported_media_type'});return true;}
      try{
        let input;try{input=JSON.parse(await readBody(request,action==='registerImports'?16384:350000));}catch(error){if(error.status===413)throw error;throw new StudyError('invalid_request');}
        if(action==='registerImports'){
          requireStudy(typeof entitlements?.forUser==='function','import_ledger_unavailable',503,'Import allowance is unavailable. Saved records remain available.');
          json(200,await entitlements.forUser(principal.uid).register(input));
        }
        else if(action==='classify'){
          requireStudy(principal?.uid,'authentication_required',401);
          requireStudy(typeof classificationService?.classify==='function','classification_unavailable',503,'Map analysis is unavailable. Your saved records are kept.');
          if(access.mode==='google'){
            requireStudy(Array.isArray(input?.videos)&&input.videos.length>0&&input.videos.length<=12,'invalid_classification_input',400);
            requireStudy(typeof entitlements?.forUser==='function','import_ledger_unavailable',503,'Import allowance is unavailable. Saved records remain available.');
            await entitlements.forUser(principal.uid).assertRegistered(input?.videos?.map(video=>video?.videoId));
          }
          json(200,await classificationService.classify(input,{principal}));
        }
        else if(action==='pptx'){const result=await service.exportPptx(input,{principal});response.writeHead(200,{'content-type':result.contentType,'content-length':result.buffer.length,'cache-control':'no-store','content-disposition':`attachment; filename="${result.filename}"`});response.end(result.buffer);}
        else json(200,await service[action](input,{principal}));
      }catch(error){
        await actionFailure(error);
      }
      return true;
    }finally{release?.();}
  };
}
