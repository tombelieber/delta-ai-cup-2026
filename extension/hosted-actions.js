import { DEFAULT_API_ENDPOINT, normalizeApiEndpoint } from './analysis-client.js';
import { validVideoId } from './store.js';
import { metadataForMap, validMapLabel } from './map-model.js';
import { validateMapAnalysisResponse } from './map-analysis-client.js';
import { PANEL_INTENT_KEY } from './learning-library.js';

export const HOSTED_ACTIONS_KEY='delta.hosted-actions.v1';
export const HOSTED_ACTION_TTL_MS=600_000;
const requestIdValid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(value);
export function hostedActionResultKey(requestId){if(!requestIdValid(requestId))throw Error('Invalid hosted request.');return `delta.hosted-action.result.v1:${requestId}`;}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=()=>{throw Error('This hosted action is not available from this page.');};
function sourceId(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www.youtube.com'&&url.pathname==='/watch'&&!url.username&&!url.password&&!url.port&&url.searchParams.getAll('v').length===1&&validVideoId(url.searchParams.get('v'))?url.searchParams.get('v'):null;}catch{return null;}}
function hostedEndpoint(value){const endpoint=normalizeApiEndpoint(value),url=new URL(endpoint);if(endpoint!==DEFAULT_API_ENDPOINT&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('Use the Delta production website or an explicit local development service.');return endpoint;}
function classificationPayload(payload){
  if(!object(payload)||!Array.isArray(payload.videos)||payload.videos.length<1||payload.videos.length>12)throw Error('Analyze between one and twelve videos per batch.');
  const videos=metadataForMap(payload.videos);
  if(videos.length!==payload.videos.length||new Set(videos.map(value=>value.videoId)).size!==videos.length)throw Error('Use distinct videos with valid titles.');
  const existingPaths=payload.existingPaths??[];
  if(!Array.isArray(existingPaths)||existingPaths.length>80||existingPaths.some(path=>!Array.isArray(path)||path.length<1||path.length>4||!path.every(validMapLabel)))throw Error('The existing topic paths are invalid.');
  const result={videos,existingPaths:existingPaths.map(path=>path.map(label=>label.normalize('NFC').replace(/\s+/g,' ')))};
  if(new TextEncoder().encode(JSON.stringify(result)).length>40_000)throw Error('This metadata batch is too large.');return result;
}
function capturedSource(value,videoId){
  if(!object(value)||value.videoId!==videoId||sourceId(value.url)!==videoId||typeof value.title!=='string'||!value.title.trim()||value.title.length>400
    ||typeof value.transcript!=='string'||!value.transcript.trim()||new TextEncoder().encode(value.transcript).length>250_000
    ||!Number.isFinite(value.start)||!Number.isFinite(value.end)||value.start<0||value.end>86_400||value.end<=value.start||value.end-value.start>300)throw Error('The captured captions did not match the selected video. Reopen its transcript and try again.');
  return {videoId,title:value.title.slice(0,300),url:`https://www.youtube.com/watch?v=${videoId}`,start:value.start,end:value.end,transcript:value.transcript};
}

export function createHostedActionBroker({api,readEndpoint,panelSender,now=Date.now,randomId=()=>crypto.randomUUID().replaceAll('-','')}={}){
  let chain=Promise.resolve();
  const serial=operation=>{const next=chain.catch(()=>{}).then(operation);chain=next;return next;};
  const persist=state=>api.storage.session.set({[HOSTED_ACTIONS_KEY]:state});
  async function read(){
    const saved=(await api.storage.session.get(HOSTED_ACTIONS_KEY))[HOSTED_ACTIONS_KEY];
    const state=saved?.schemaVersion===1&&object(saved.pending)&&object(saved.results)?saved:{schemaVersion:1,pending:{},results:{}};
    let changed=false;
    for(const [id,expiresAt]of Object.entries(state.results))if(!Number.isFinite(expiresAt)||expiresAt<=now()){delete state.results[id];await api.storage.session.remove(hostedActionResultKey(id));changed=true;}
    for(const [nonce,pending]of Object.entries(state.pending))if(!Number.isFinite(pending.expiresAt)||pending.expiresAt<=now()){
      delete state.pending[nonce];if(pending.action==='classify')await finish(state,pending,'cancelled',null,'This action expired. Open it again from Delta.');changed=true;
    }
    if(changed)await persist(state);return state;
  }
  async function finish(state,pending,status,result=null,error='',details={}){
    delete state.pending[pending.nonce];
    if(pending.action!=='classify')return;
    const ids=Object.keys(state.results);while(ids.length>=16){const id=ids.shift();delete state.results[id];await api.storage.session.remove(hostedActionResultKey(id));}
    state.results[pending.requestId]=now()+HOSTED_ACTION_TTL_MS;
    const httpStatus=[400,401,403,409,422,429,500,503,504].includes(details.status)?details.status:null;
    const code=httpStatus===429?'QUOTA':[401,403].includes(httpStatus)?'AUTH_REQUIRED':status==='cancelled'?'CANCELLED':'HOSTED_UNAVAILABLE';
    await api.storage.session.set({[hostedActionResultKey(pending.requestId)]:{requestId:pending.requestId,action:pending.action,status,endpoint:pending.endpoint,...(result?{result}:{}),...(error?{error,code,...(httpStatus?{httpStatus}:{})}:{}),at:now()}});
  }
  function internalSender(sender){return sender?.id===api.runtime.id&&panelSender(sender);}
  async function waitForYouTube(tab){
    if(tab.status==='complete'||!api.tabs.onUpdated?.addListener)return;
    await new Promise(resolve=>{
      let complete=false;const stop=()=>{if(complete)return;complete=true;clearTimeout(timer);api.tabs.onUpdated.removeListener?.(listener);resolve();};
      const listener=(id,change)=>{if(id===tab.id&&change.status==='complete')stop();};
      const timer=setTimeout(stop,15000);api.tabs.onUpdated.addListener(listener);
      api.tabs.get(tab.id).then(value=>{if(value?.status==='complete')stop();},stop);
    });
  }
  async function capture(tabId,message){let timer;try{return await Promise.race([api.tabs.sendMessage(tabId,message),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),15000);})]);}catch{return null;}finally{clearTimeout(timer);}}
  async function open(message){
    const endpoint=hostedEndpoint(await readEndpoint());if(message.endpoint&&message.endpoint!==endpoint)throw Error('The service changed. Open the action again.');
    if(!requestIdValid(message.requestId)||!['learn','classify'].includes(message.action))throw Error('Invalid hosted action.');
    const state=await read();if(Object.keys(state.pending).length>=8)throw Error('Finish or close another pending Delta action first.');
    if(Object.values(state.pending).some(value=>value.requestId===message.requestId)||state.results[message.requestId])throw Error('This action has already been opened.');
    let payload;
    if(message.action==='classify')payload=classificationPayload(message.payload);
    else{
      if(message.videoId!=null&&!validVideoId(message.videoId))throw Error('Open a YouTube video before learning.');
      const matching=value=>Number.isInteger(value?.id)&&sourceId(value.url)&&(!message.videoId||sourceId(value.url)===message.videoId);
      const tabs=Number.isInteger(message.tabId)?[await api.tabs.get(message.tabId)]:await api.tabs.query({active:true,lastFocusedWindow:true});
      let tab=tabs.find(matching);
      if(!tab&&!Number.isInteger(message.tabId)&&message.videoId){
        tab=(await api.tabs.query({url:'https://www.youtube.com/watch*'})).find(matching);
        if(!tab){tab=await api.tabs.create({url:`https://www.youtube.com/watch?v=${message.videoId}`});if(Number.isInteger(tab?.id)){await waitForYouTube(tab);tab=await api.tabs.get(tab.id);}}
      }
      if(!tab)throw Error('Open the matching YouTube video before learning.');
      const videoId=sourceId(tab.url);
      const intent=(await api.storage.session.get(PANEL_INTENT_KEY))[PANEL_INTENT_KEY];
      if(intent?.tabId===tab.id&&intent.videoId===videoId)await api.storage.session.remove(PANEL_INTENT_KEY);
      if((message.start!=null&&!Number.isFinite(message.start))||(message.end!=null&&!Number.isFinite(message.end)))throw Error('Use a valid caption clip.');
      if(message.start!=null&&message.start<0||message.end!=null&&(message.end>86_400||message.end<0)||message.start!=null&&message.end!=null&&(message.end<=message.start||message.end-message.start>300))throw Error('Choose a caption clip of up to five minutes.');
      const captured=await capture(tab.id,{type:'DELTA_CAPTURE_TRANSCRIPT',videoId,...(message.start!=null?{start:message.start}:{}),...(message.end!=null?{end:message.end}:{})});
      payload=captured?.ok?capturedSource(captured,videoId):{videoId,title:typeof tab.title==='string'?tab.title.slice(0,300):'YouTube video',url:`https://www.youtube.com/watch?v=${videoId}`,captureError:'Captions were unavailable. Open the video transcript on YouTube, then try again. Prepared sources and manual caption import remain available.'};
    }
    const nonce=randomId();if(typeof nonce!=='string'||!/^[a-f0-9]{32}$/.test(nonce))throw Error('The secure action could not be created.');
    const tab=await api.tabs.create({url:'about:blank'});if(!Number.isInteger(tab?.id))throw Error('The learning website could not be opened.');
    const pending={nonce,requestId:message.requestId,action:message.action,endpoint,tabId:tab.id,payload,createdAt:now(),expiresAt:now()+HOSTED_ACTION_TTL_MS};
    state.pending[nonce]=pending;await persist(state);
    const url=new URL('/learn',endpoint);url.searchParams.set('hosted','1');url.searchParams.set('extension',api.runtime.id);url.searchParams.set('request',nonce);if(message.action==='learn')url.searchParams.set('videoId',payload.videoId);
    try{await api.tabs.update(tab.id,{url:url.href});}catch{await finish(state,pending,'error',null,'The learning website could not be opened.');await persist(state);throw Error('The learning website could not be opened.');}
    return {ok:true,action:message.action,opened:true,requestId:message.requestId,nonce,tabId:tab.id};
  }
  async function handleInternal(message,sender){
    if(!internalSender(sender))fail();
    return serial(async()=>{
      if(message?.type==='DELTA_HOSTED_ACTION_OPEN')return open(message);
      if(message?.type==='DELTA_HOSTED_ACTION_CANCEL'){
        if(!requestIdValid(message.requestId))fail();const state=await read();const pending=Object.values(state.pending).find(value=>value.requestId===message.requestId);
        if(pending){await finish(state,pending,'cancelled',null,'Map analysis stopped. Your records are saved.');await persist(state);}return {ok:true};
      }
      fail();
    });
  }
  async function handleExternal(message,sender){return serial(async()=>{
    if(sender?.id||sender?.frameId!==0||!Number.isInteger(sender?.tab?.id)||typeof message?.requestId!=='string'||!/^[a-f0-9]{32}$/.test(message.requestId))fail();
    const state=await read(),pending=state.pending[message.requestId];if(!pending||pending.tabId!==sender.tab.id)fail();
    let url;try{url=new URL(sender.url);}catch{fail();}
    if(url.origin!==pending.endpoint||sender.origin!=null&&sender.origin!==pending.endpoint||url.pathname!=='/learn'||url.searchParams.get('hosted')!=='1'||url.searchParams.get('request')!==pending.nonce||url.searchParams.get('extension')!==api.runtime.id)fail();
    if(message.type==='DELTA_HOSTED_ACTION_GET')return {ok:true,action:pending.action,requestId:pending.nonce,expiresAt:pending.expiresAt,payload:pending.payload};
    if(message.type==='DELTA_HOSTED_ACTION_RESULT'&&pending.action==='classify'){
      const result=validateMapAnalysisResponse(message.result,pending.payload.videos);await finish(state,pending,'complete',result);await persist(state);return {ok:true};
    }
    if(message.type==='DELTA_HOSTED_ACTION_ERROR'&&pending.action==='classify'){
      const messageText=message.status===429?'Your free AI allowance or the model quota is unavailable. Your records are saved.':'Map analysis did not finish. Your records are saved. Return to Delta and try again.';
      await finish(state,pending,'error',null,messageText,{status:message.status});await persist(state);return {ok:true};
    }
    fail();
  });}
  async function handleTabRemoved(tabId){return serial(async()=>{const state=await read();for(const pending of Object.values(state.pending))if(pending.tabId===tabId)await finish(state,pending,'cancelled',null,'The learning website was closed. Your records are saved.');await persist(state);});}
  return {handleInternal,handleExternal,handleTabRemoved};
}
