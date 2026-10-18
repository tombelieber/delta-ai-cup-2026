const KEY='delta.study.local.v1';
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
function youtubeId(value){try{const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return '';
  const id=url.hostname==='youtu.be'?url.pathname.slice(1):['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname)&&url.pathname==='/watch'?url.searchParams.get('v'):'';
  return VIDEO_ID.test(id||'')?id:'';}catch{return '';}}
export function studyVideoId(source){if(typeof source==='string')return VIDEO_ID.test(source)?source:youtubeId(source);return VIDEO_ID.test(source?.videoId||'')?source.videoId:youtubeId(source?.url||source?.videoUrl);}
export function studySourceFromSearch(search=''){
  const query=new URLSearchParams(search);if(!query.has('videoId'))return null;
  const videoId=query.get('videoId');if(!VIDEO_ID.test(videoId||''))throw Error('This YouTube video ID is invalid. Open the Learning lab to choose a source.');
  return {videoId,url:`https://www.youtube.com/watch?v=${videoId}`};
}
export function validateStudyInitialSource(input,expectedSource){
  const videoId=input?.videoId,expectedId=expectedSource?.videoId||youtubeId(expectedSource?.url||expectedSource?.videoUrl);
  if(!VIDEO_ID.test(videoId||'')||expectedId&&expectedId!==videoId||youtubeId(input.url)!==videoId)throw Error('Captured captions must match the selected YouTube video.');
  const text=input.transcript;
  if(typeof text!=='string'||!text.trim()||new TextEncoder().encode(text).length>250000)throw Error('Provide caption text under 250 KB.');
  if(text.match(/^Video ID: ([A-Za-z0-9_-]{11})$/m)?.[1]!==videoId)throw Error('Captured captions must match the selected YouTube video.');
  const {start,end}=input;
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start>300||end>86400)throw Error('Choose a caption clip of at most five minutes.');
  return {videoId,title:String(input.title||expectedSource?.title||videoId).slice(0,200),url:`https://www.youtube.com/watch?v=${videoId}`,text,start,end};
}
export function restoreStudySelection(items,requestedVideoId=''){
  requestedVideoId=studyVideoId(requestedVideoId);
  const item=requestedVideoId?items.filter(x=>x.lesson.source.videoId===requestedVideoId).at(-1):items.at(-1);
  const profile=item?.lesson.profile||{level:'beginner',language:'en',interests:[]};
  return {activeId:item?.lesson.id||'',videoId:requestedVideoId||item?.lesson.source.videoId||'733mgqrzNKs',profile,interest:(profile.interests||[]).join(', ')};
}
export function browserStudyStorage(scope=''){const key=scope?`${KEY}:${scope}`:KEY;return {
  async get(){if(globalThis.chrome?.storage?.local)return (await chrome.storage.local.get(key))[key]||null;
    const value=globalThis.localStorage.getItem(key);return value?JSON.parse(value):null;},
  async set(value){if(globalThis.chrome?.storage?.local)await chrome.storage.local.set({[key]:value});else globalThis.localStorage.setItem(key,JSON.stringify(value));},
};}
export function createStudyClient({endpoint='',fetchImpl=globalThis.fetch,storage=null,userId='',getToken=null}={}){
  if(getToken&&!userId)throw Error('Authenticated learning requires a user-scoped library.');
  let chain=Promise.resolve();
  const origin=endpoint.replace(/\/$/,'');
  const scope=userId?`${origin}:user:${encodeURIComponent(userId)}`:origin;
  storage||=browserStudyStorage(scope);
  const library=async()=>{const saved=await storage.get();if(!saved)return {schemaVersion:1,items:[]};
    if(saved.schemaVersion!==1||!Array.isArray(saved.items))throw Error('Saved learning could not be read. Export a backup before replacing it.');return saved;};
  const change=operation=>{const commit=async()=>{const value=await library(),result=await operation(value);await storage.set(value);return result;};
    const next=chain.catch(()=>{}).then(()=>globalThis.navigator?.locks?.request?globalThis.navigator.locks.request(`${KEY}:${scope}`,commit):commit());chain=next;return next;};
  async function request(action,body,binary=false){const token=getToken?await getToken():null;
    if(getToken&&!token)throw Error('Sign in with Google to continue this learning step.');
    const response=await fetchImpl(`${origin}/api/study/${action}`,{method:body===undefined?'GET':'POST',redirect:'error',credentials:'omit',cache:'no-store',
      headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(95000)});
    if(!response.ok){let value;try{value=await response.json();}catch{}const error=Error(value?.message||'Delta could not complete this learning step. Your saved work is kept.');error.code=value?.error;error.status=response.status;throw error;}
    return binary?response.blob():response.json();}
  function validateResult(result){if(!result?.lesson?.id||typeof result.lessonToken!=='string'||!result.lessonToken||!Array.isArray(result.lesson.exercises)||!Array.isArray(result.lesson.slides))throw Error('The lesson response was incomplete. Your previous work is kept.');}
  return {library,request,
    catalogue:()=>request('catalogue'),
    session:()=>request('session'),
    async generate(input){const result=await request('generate',input);validateResult(result);
      await change(value=>{const existing=value.items.find(x=>x.lesson.id===result.lesson.id);
        if(existing){Object.assign(existing,{...result,attempts:existing.attempts||[]});return;}
        if(value.items.length>=20)throw Error('Your local library is full. Export a backup before adding another lesson.');
        value.items.push({...result,attempts:[]});});return result;},
    saveAttempt:feedback=>change(value=>{const item=value.items.find(x=>x.lesson.id===feedback.lessonId);
      if(!item||!item.lesson.exercises.some(e=>e.id===feedback.taskId)||feedback.method!=='ai-authored-key-match'||typeof feedback.passed!=='boolean')throw Error('The practice feedback did not match a saved lesson.');
      item.attempts||=[];if(item.attempts.length>=100)throw Error('This lesson has reached its saved attempt limit.');item.attempts.push(feedback);return feedback;}),
    async answer(input){const result=await request('answer',input);await this.saveAttempt(result);return result;},
    async ask(input){const result=await request('ask',input);await change(value=>{const item=value.items.find(x=>x.lessonToken===input.lessonToken);if(item)item.cost=result.cost;});return result;},
    pptx:input=>request('pptx',input,true),
    async preparePptx(input){const preparedAt=Date.now(),ticket=await request('preparePptx',input);
      if(!/^\/api\/study\/download\/[a-f0-9-]{36}$/.test(ticket.url)||typeof ticket.filename!=='string'||!ticket.filename||!Number.isFinite(ticket.expiresInSeconds)||ticket.expiresInSeconds<=0||ticket.expiresInSeconds>90)throw Error('The export response was incomplete.');
      if(getToken){const blob=await request(ticket.url.slice('/api/study/'.length),undefined,true);return {href:URL.createObjectURL(blob),name:ticket.filename};}
      return {href:`${origin}${ticket.url}`,name:ticket.filename,expiresAt:preparedAt+ticket.expiresInSeconds*1000};},
  };
}
