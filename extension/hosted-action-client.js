import { hostedActionResultKey, HOSTED_ACTION_TTL_MS } from './hosted-actions.js';
const issue=(message,code='HOSTED_UNAVAILABLE',status=null)=>Object.assign(Error(message),{code,...(status?{status}:{})});

export function openHostedAction({action,payload,videoId,tabId,start,end,endpoint,signal,onStatus}={}, {api=globalThis.chrome,timeoutMs=HOSTED_ACTION_TTL_MS}={}){
  const stopped=action==='imports'?'History import stopped. Your existing saved records are kept.':'Map analysis stopped. Your records are saved.';
  if(signal?.aborted)return Promise.reject(issue(stopped,'CANCELLED'));
  if(!api?.runtime?.sendMessage||!api?.storage?.session||!api?.storage?.onChanged)return Promise.reject(Error('Open this action from the Delta extension.'));
  const requestId=crypto.randomUUID(),key=hostedActionResultKey(requestId);
  return new Promise((resolve,reject)=>{
    let finished=false,timer;
    function settle(error,result){if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);api.storage.onChanged.removeListener(changed);void api.storage.session.remove(key).catch(()=>{});if(error)reject(error);else resolve(result);}
    const notify=status=>{try{onStatus?.(status);}catch{}};
    function result(value){if(!value||value.requestId!==requestId||value.action!==action)return;if(value.status==='complete'){notify('complete');settle(null,value.result);}else if(['error','cancelled'].includes(value.status))settle(issue(value.error||stopped,['QUOTA','AUTH_REQUIRED','CANCELLED','HOSTED_UNAVAILABLE'].includes(value.code)?value.code:'HOSTED_UNAVAILABLE',[401,402,403,429,500,503,504].includes(value.httpStatus)?value.httpStatus:null));}
    function changed(changes,area){if(area==='session'&&changes[key]?.newValue)result(changes[key].newValue);}
    function abort(){cancel('CANCELLED');}
    function cancel(code){void api.runtime.sendMessage({type:'DELTA_HOSTED_ACTION_CANCEL',requestId}).catch(()=>{});settle(issue(code==='TIMEOUT'?(action==='imports'?'History import timed out. Your existing saved records are kept.':'Map analysis timed out. Your records are saved.'):stopped,code));}
    api.storage.onChanged.addListener(changed);signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>cancel('TIMEOUT'),Number.isFinite(timeoutMs)&&timeoutMs>0?Math.min(timeoutMs,HOSTED_ACTION_TTL_MS):HOSTED_ACTION_TTL_MS);
    notify(action==='learn'?'capturing':'opening');
    Promise.resolve(api.runtime.sendMessage({type:'DELTA_HOSTED_ACTION_OPEN',action,requestId,...(payload?{payload}:{}),...(videoId?{videoId}:{}),...(tabId!=null?{tabId}:{}),...(start!=null?{start}:{}),...(end!=null?{end}:{}),...(endpoint?{endpoint}:{})})).then(async response=>{
      if(finished){if(response?.ok)void api.runtime.sendMessage({type:'DELTA_HOSTED_ACTION_CANCEL',requestId}).catch(()=>{});return;}
      if(!response?.ok)throw Error(response?.error||'The learning website could not be opened.');
      if(action==='learn'){notify('opening');settle(null,response);return;}
      notify('waiting');result((await api.storage.session.get(key))[key]);
    }).catch(error=>settle(error));
  });
}
