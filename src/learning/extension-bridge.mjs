const safeError=()=>Error('Open this action again from the Delta extension. The website connection could not be verified.');
export function parseExtensionBridgeLocation(location=globalThis.location){
  let url;try{url=new URL(typeof location==='string'?location:location.href);}catch{throw safeError();}
  const extensionId=url.searchParams.get('extension'),requestId=url.searchParams.get('request');
  if(url.pathname!=='/learn'||url.searchParams.get('hosted')!=='1'||url.searchParams.getAll('extension').length!==1||url.searchParams.getAll('request').length!==1
    ||!/^[a-p]{32}$/.test(extensionId||'')||!/^[a-f0-9]{32}$/.test(requestId||''))throw safeError();
  return {extensionId,requestId};
}
function classificationData(value){
  return {schemaVersion:value?.schemaVersion,model:value?.model,cached:value?.cached,
    items:Array.isArray(value?.items)?value.items.map(item=>({videoId:item?.videoId,path:item?.path,confidence:item?.confidence,contentType:item?.contentType})):[],
    ...(Array.isArray(value?.unresolved)?{unresolved:value.unresolved.map(item=>({videoId:item?.videoId,reason:item?.reason}))}:{}),
    ...(Array.isArray(value?.unresolvedIds)?{unresolvedIds:value.unresolvedIds.filter(item=>typeof item==='string')}:{}),
  };
}
export function createExtensionBridge({location=globalThis.location,runtime=globalThis.chrome?.runtime,timeoutMs=15000}={}){
  const {extensionId,requestId}=parseExtensionBridgeLocation(location);
  function send(type,extra={}){return new Promise((resolve,reject)=>{
    if(typeof runtime?.sendMessage!=='function'){reject(Error('The Delta extension is unavailable. Open this action from the installed extension.'));return;}
    let settled=false;const timer=setTimeout(()=>{if(!settled){settled=true;reject(safeError());}},timeoutMs);
    try{runtime.sendMessage(extensionId,{type,requestId,...extra},response=>{
      if(settled)return;settled=true;clearTimeout(timer);
      if(runtime.lastError||!response?.ok){reject(safeError());return;}resolve(response);
    });}catch{clearTimeout(timer);settled=true;reject(safeError());}
  });}
  return {load:()=>send('DELTA_HOSTED_ACTION_GET'),complete:result=>send('DELTA_HOSTED_ACTION_RESULT',{result:classificationData(result)}),fail:(issue={})=>{
    const status=[400,401,403,409,422,429,500,503,504].includes(issue.status)?issue.status:null;
    return send('DELTA_HOSTED_ACTION_ERROR',{code:status===429?'QUOTA':[401,403].includes(status)?'AUTH_REQUIRED':'HOSTED_UNAVAILABLE',...(status?{status}:{})});
  }};
}
