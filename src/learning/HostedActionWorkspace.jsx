import React,{useEffect,useMemo,useRef,useState} from 'react';
import StudyWorkspace from './StudyWorkspace.jsx';
import StudyAccount from './StudyAccount.jsx';
import {createStudyAuth} from './study-auth.mjs';
import {createStudyClient} from './study-client.mjs';
import {createExtensionBridge} from './extension-bridge.mjs';
import {validateMapAnalysisResponse} from '../../extension/map-analysis-client.js';
import './study.css';

export default function HostedActionWorkspace({endpoint='',authConfig}={}){
  const [connection,setConnection]=useState({status:'loading'});
  useEffect(()=>{let alive=true;let bridge;try{bridge=createExtensionBridge();}catch(error){setConnection({status:'error',error:error.message});return;}
    bridge.load().then(value=>{if(!alive)return;if(!['learn','classify','imports'].includes(value.action)||!value.payload)throw Error('This action is unavailable. Open it again from Delta.');setConnection({status:'ready',bridge,...value});}).catch(error=>{if(alive)setConnection({status:'error',error:error.message});});return()=>{alive=false;};},[]);
  if(connection.status==='loading')return <section className="study-workspace"><p role="status">Connecting your selected video from Delta…</p></section>;
  if(connection.status==='error')return <section className="study-workspace"><h1>Reconnect from Delta.</h1><p role="alert">{connection.error}</p><a href="/learn?study=1">Open the learning lab</a></section>;
  if(connection.action==='learn')return <>{connection.payload.captureError&&<p role="status" className="study-error">Captions were unavailable. Open the transcript on YouTube and choose Learn again, or use a prepared source or matching caption file.</p>}<StudyWorkspace endpoint={endpoint} authConfig={authConfig} sourceVideo={connection.payload} initialSource={connection.payload.transcript?connection.payload:null}/></>;
  if(connection.action==='imports')return <HostedImports endpoint={endpoint} authConfig={authConfig} bridge={connection.bridge} payload={connection.payload}/>;
  return <HostedClassification endpoint={endpoint} authConfig={authConfig} bridge={connection.bridge} payload={connection.payload}/>;
}
function HostedClassification({endpoint,authConfig,bridge,payload}){
  const auth=useMemo(()=>createStudyAuth({endpoint,authConfig}),[endpoint,authConfig]);
  const [account,setAccount]=useState(()=>auth.snapshot()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[complete,setComplete]=useState(false),[terminal,setTerminal]=useState(false),[funding,setFunding]=useState('free');
  const canClassify=funding==='paid'?account.entitlements?.paid?.classificationAvailable:account.quota?.remainingUsd>0;
  const operation=useRef(crypto.randomUUID());
  const running=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;const unsubscribe=auth.subscribe(setAccount);void auth.initialize();return()=>{alive.current=false;unsubscribe();auth.dispose();};},[auth]);
  async function classify(){
    if(running.current||complete||terminal||account.status!=='signed-in'||!canClassify)return;
    running.current=true;setBusy(true);setError('');const uid=account.user.uid;
    try{
      const client=createStudyClient({endpoint,userId:uid,getToken:()=>auth.getToken(uid)});
      await client.registerImports({operationId:operation.current,videoIds:payload.videos.map(video=>video.videoId)});
      if(!alive.current||auth.snapshot().user?.uid!==uid)throw Error('Your account changed. Open the map action again from Delta.');
      const raw=await client.request('classify',{...payload,...(funding==='paid'?{funding}:{})});
      if(!alive.current||auth.snapshot().user?.uid!==uid)throw Error('Your account changed. Open the map action again from Delta.');
      const result=validateMapAnalysisResponse(raw,payload.videos);
      await bridge.complete(result);if(alive.current){setComplete(true);setTerminal(true);}
    }catch(value){if(alive.current){setError(value.status===429?'Your free allowance or the model quota is unavailable. Your local records are kept.':value.message||'Map analysis did not finish. Your local records are kept.');setTerminal(true);}await bridge.fail(value).catch(()=>{});
    }finally{running.current=false;if(alive.current)setBusy(false);void auth.refreshSession().catch(()=>{});void auth.refreshEntitlements().catch(()=>{});}
  }
  return <section className="study-workspace"><StudyAccount auth={auth} state={account} endpoint={endpoint}/><header className="study-heading"><div><span className="study-kicker">DELTA · MY MAP</span><h1>Organise your selected videos.</h1><p>Only the selected public titles and channels are sent for AI classification. Your viewing times and account credentials stay out of the extension handoff.</p></div></header>
    <p>{payload.videos.length} selected {payload.videos.length===1?'video':'videos'} · new videos use your account import allowance; classification uses the allowance selected below.</p>
    {account.entitlements?.paid?.classificationAvailable&&<label>Classification allowance<select disabled={busy||terminal} value={funding} onChange={event=>setFunding(event.target.value)}><option value="free">Use free AI credit</option><option value="paid">Use Starter Pack map allocation · no learning session used</option></select></label>}
    <ul>{payload.videos.map(video=><li key={video.videoId}>{video.title}{video.channel?` · ${video.channel}`:''}</li>)}</ul>
    {error&&<p className="study-error" role="alert">{error} Return to the extension to open a new action.</p>}
    {complete?<p role="status">Your map results were returned to the Delta extension. You can close this tab.</p>:<button className="study-primary" type="button" disabled={busy||terminal||account.status!=='signed-in'||!canClassify} onClick={classify}>{busy?'Analysing selected metadata…':'Analyze selected videos'}</button>}
  </section>;
}

function HostedImports({endpoint,authConfig,bridge,payload}){
  const auth=useMemo(()=>createStudyAuth({endpoint,authConfig}),[endpoint,authConfig]);
  const [account,setAccount]=useState(()=>auth.snapshot()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[complete,setComplete]=useState(false),[terminal,setTerminal]=useState(false);
  const running=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;const unsubscribe=auth.subscribe(setAccount);void auth.initialize();return()=>{alive.current=false;unsubscribe();auth.dispose();};},[auth]);
  async function register(){
    if(running.current||complete||terminal||account.status!=='signed-in')return;
    running.current=true;setBusy(true);setError('');const uid=account.user.uid;
    try{
      const client=createStudyClient({endpoint,userId:uid,getToken:()=>auth.getToken(uid)}),result=await client.registerImports(payload);
      if(!alive.current||auth.snapshot().user?.uid!==uid)throw Error('Your Google account changed. Return to Delta and open the import again.');
      await bridge.completeImport(result);if(alive.current){setComplete(true);setTerminal(true);}
    }catch(value){if(alive.current){setError(value.message||'Your import allowance could not be verified.');setTerminal(true);}await bridge.fail(value).catch(()=>{});
    }finally{running.current=false;if(alive.current)setBusy(false);void auth.refreshEntitlements().catch(()=>{});}
  }
  return <section className="study-workspace"><StudyAccount auth={auth} state={account} endpoint={endpoint}/><header className="study-heading"><div><h1>Save your selected history.</h1><p>Confirm your Delta account to register {payload.videoIds.length} selected {payload.videoIds.length===1?'video':'videos'}.</p></div></header>
    <p>Your first ten distinct videos are free across all imports and devices. Registering the same video again uses no additional import. This step uses no AI credit.</p>
    <p>Video IDs are verified here. Your history titles and viewing dates remain in the extension. The server keeps keyed identifiers and an allowance counter.</p>
    {error&&<p role="alert" className="study-error">{error} Return to Delta to try again.</p>}
    {complete?<p role="status">Import allowance verified. Return to Delta to check that your videos were saved. You can close this tab.</p>:<button type="button" className="study-primary" disabled={busy||terminal||account.status!=='signed-in'} onClick={register}>{busy?'Verifying import allowance…':'Register selected videos'}</button>}
  </section>;
}
