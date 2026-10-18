import {createMapPanelController,MAP_ACCESS_KEY} from '../../extension/map-panel-controller.js';
import {MAP_CLASSIFICATION_KEY} from '../../extension/map-model.js';
import {MAP_HOSTED_ENDPOINT,MapAnalysisError} from '../../extension/map-analysis-client.js';
import {createStudyClient} from './study-client.mjs';

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const issue=(message,code='WEB_MAP_UNAVAILABLE')=>new MapAnalysisError(message,{code});
const check=(condition,message,code='INVALID_IMPORT')=>{if(!condition)throw issue(message,code);};
const clean=value=>value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const ownsOnly=(value,keys)=>Object.keys(value).every(key=>keys.includes(key));

/** Explicit metadata-file import. No heuristics, history timestamps or skills. */
export function normalizeWebMapImport(value){
  check(object(value)&&ownsOnly(value,['schemaVersion','videos'])&&value.schemaVersion===1&&Array.isArray(value.videos)
    &&value.videos.length>=1&&value.videos.length<=100,'Choose a Delta metadata JSON file containing 1–100 videos.');
  const seen=new Set(),videos=[];
  for(const row of value.videos){
    check(object(row)&&ownsOnly(row,['videoId','title','channel','dateLabel','pageOrder'])&&typeof row.videoId==='string'&&/^[A-Za-z0-9_-]{11}$/.test(row.videoId)
      &&typeof row.title==='string'&&row.title.length<=300&&clean(row.title)
      &&typeof row.channel==='string'&&row.channel.length<=150,
    'The metadata file has an invalid video. No records were imported.');
    check(row.dateLabel===undefined||typeof row.dateLabel==='string'&&row.dateLabel.length<=100,
      'The metadata file has an invalid displayed date. No records were imported.');
    check(row.pageOrder===undefined||Number.isSafeInteger(row.pageOrder)&&row.pageOrder>=0&&row.pageOrder<100,
      'The metadata file has an invalid page position. No records were imported.');
    if(seen.has(row.videoId))continue;seen.add(row.videoId);
    videos.push({videoId:row.videoId,title:clean(row.title),channel:clean(row.channel),
      ...(row.dateLabel===undefined?{}:{dateLabel:clean(row.dateLabel)}),...(row.pageOrder===undefined?{}:{pageOrder:row.pageOrder})});
  }
  return {schemaVersion:1,videos};
}

export function webMapJournal(value){
  if(!value)return {entries:[]};
  const {videos}=normalizeWebMapImport(value);
  return {entries:videos.map(video=>({videoId:video.videoId,title:video.title,channel:video.channel,
    url:`https://www.youtube.com/watch?v=${video.videoId}`,accountHistory:true,hasPlayback:false,watchedSeconds:0,
    imported:false,visitedAt:null,lastActivityAt:null,learningStarted:false,hasLesson:false,checkedTasks:0,tasks:[],
    topicLabel:'Not yet grouped',kind:'unknown',historyDates:video.dateLabel?[{date:null,dateLabel:video.dateLabel,datePrecision:'unknown'}]:[]}))};
}

/** Reuse the production map queue with website-owned storage and auth transport. */
export function createWebMapClient({uid,auth,endpoint=globalThis.location?.origin,location=globalThis.location,
  storage=globalThis.localStorage,fetchImpl=globalThis.fetch,now=Date.now}={}){
  check(typeof uid==='string'&&uid&&uid.length<=128&&typeof auth?.getToken==='function'
    &&typeof auth?.snapshot==='function','Sign in with Google to open My Map.','AUTH_REQUIRED');
  check(endpoint===location?.origin&&endpoint===MAP_HOSTED_ENDPOINT,'Open My Map from the hosted Delta website.','INVALID_ENDPOINT');
  check(typeof storage?.getItem==='function'&&typeof storage?.setItem==='function','Browser storage is unavailable. Your records were not changed.','STORAGE_UNAVAILABLE');
  const key=`delta.map.web.v1:${encodeURIComponent(endpoint)}:user:${encodeURIComponent(uid)}`;
  let writes=Promise.resolve(),disposed=false,activeRun=false;
  const current=()=>{
    const account=auth.snapshot();
    check(!disposed&&account.status==='signed-in'&&account.user?.uid===uid,'Your Google account changed. Open My Map again.','ACCOUNT_CHANGED');
    return account;
  };
  const spending=()=>{const account=current();check(account.quota?.remainingUsd>0,'Your AI allowance is unavailable or used up. Saved map records remain available.','CREDIT_UNAVAILABLE');};
  function read(){
    current();const raw=storage.getItem(key);if(raw===null)return {schemaVersion:1,imported:null,values:{}};
    let saved;try{saved=JSON.parse(raw);}catch{throw issue('Saved map data could not be read. Nothing was replaced.','STORAGE_INVALID');}
    check(object(saved)&&saved.schemaVersion===1&&object(saved.values),'Saved map data could not be read. Nothing was replaced.','STORAGE_INVALID');
    if(saved.imported!==null)normalizeWebMapImport(saved.imported);
    return saved;
  }
  function change(operation){
    const commit=async()=>{current();const saved=read();await operation(saved);current();storage.setItem(key,JSON.stringify(saved));};
    const next=writes.catch(()=>{}).then(()=>globalThis.navigator?.locks?.request?globalThis.navigator.locks.request(key,commit):commit());
    writes=next.catch(()=>{});return next;
  }
  const local={
    async get(name){await writes;current();return {[name]:read().values[name]??null};},
    async set(values){check(object(values)&&Object.keys(values).every(name=>name===MAP_CLASSIFICATION_KEY||name===MAP_ACCESS_KEY&&values[name]===null),
      'An unsupported map value was refused.','INVALID_STORAGE_WRITE');await change(saved=>{Object.assign(saved.values,values);});},
  };
  const journal=async()=>{await writes;return webMapJournal(read().imported);};
  const map=createMapPanelController({storage:local,permissions:{request:async()=>{spending();return true;}},
    libraryClient:{list:async()=>({journal:await journal()})},readEndpoint:()=>endpoint,now,
    fetchImpl:async(...args)=>{current();return fetchImpl(...args);},
    openHostedAction:async({action,endpoint:requested,payload,signal})=>{
      spending();check(action==='classify'&&requested===endpoint,'This map action is unavailable.','INVALID_ACTION');
      check(!signal?.aborted,'Map analysis stopped. Your records are saved.','CANCELLED');
      const signedClient=createStudyClient({endpoint,userId:uid,getToken:()=>auth.getToken(uid),fetchImpl:async(url,options)=>{
        current();return fetchImpl(url,{...options,signal:signal?AbortSignal.any([options.signal,signal]):options.signal});
      }});
      try{const result=await signedClient.request('classify',payload);current();check(!signal?.aborted,'Map analysis stopped. Your records are saved.','CANCELLED');return result;}
      finally{if(!disposed&&auth.snapshot().user?.uid===uid)void auth.refreshSession?.().catch(()=>{});}
    }});
  return {...map,journal,
    async begin(){activeRun=true;try{return await map.begin();}catch(error){activeRun=false;throw error;}},
    async classifyNext(options){try{const next=await map.classifyNext(options);if(!next.status?.pending)activeRun=false;return next;}catch(error){activeRun=false;throw error;}},
    cancel(){activeRun=false;map.cancel();},
    async importRecords(value){
      current();const incoming=normalizeWebMapImport(value);if(activeRun){activeRun=false;map.cancel();}
      await change(saved=>{
        const currentRows=saved.imported?.videos||[],ids=new Set(incoming.videos.map(video=>video.videoId));
        const videos=[...incoming.videos,...currentRows.filter(video=>!ids.has(video.videoId))];
        check(videos.length<=100,'This account already has other imported records. The combined map would exceed 100 videos. Nothing was replaced.');
        saved.imported={schemaVersion:1,videos};
      });
      return journal();
    },
    destroy(){if(disposed)return;disposed=true;map.destroy();},
  };
}
