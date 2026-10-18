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
    bridge.load().then(value=>{if(!alive)return;if(!['learn','classify'].includes(value.action)||!value.payload)throw Error('This action is unavailable. Open it again from Delta.');setConnection({status:'ready',bridge,...value});}).catch(error=>{if(alive)setConnection({status:'error',error:error.message});});return()=>{alive=false;};},[]);
  if(connection.status==='loading')return <section className="study-workspace"><p role="status">Connecting your selected video from Delta…</p></section>;
  if(connection.status==='error')return <section className="study-workspace"><h1>Reconnect from Delta.</h1><p role="alert">{connection.error}</p><a href="/learn?study=1">Open the learning lab</a></section>;
  if(connection.action==='learn')return <>{connection.payload.captureError&&<p role="status" className="study-error">Captions were unavailable. Open the transcript on YouTube and choose Learn again, or use a prepared source or matching caption file.</p>}<StudyWorkspace endpoint={endpoint} authConfig={authConfig} sourceVideo={connection.payload} initialSource={connection.payload.transcript?connection.payload:null}/></>;
  return <HostedClassification endpoint={endpoint} authConfig={authConfig} bridge={connection.bridge} payload={connection.payload}/>;
}
function HostedClassification({endpoint,authConfig,bridge,payload}){
  const auth=useMemo(()=>createStudyAuth({endpoint,authConfig}),[endpoint,authConfig]);
  const [account,setAccount]=useState(()=>auth.snapshot()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[complete,setComplete]=useState(false),[terminal,setTerminal]=useState(false);
  const running=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;const unsubscribe=auth.subscribe(setAccount);void auth.initialize();return()=>{alive.current=false;unsubscribe();auth.dispose();};},[auth]);
  async function classify(){
    if(running.current||complete||terminal||account.status!=='signed-in'||!account.quota?.remainingUsd)return;
    running.current=true;setBusy(true);setError('');const uid=account.user.uid;
    try{
      const client=createStudyClient({endpoint,userId:uid,getToken:()=>auth.getToken(uid)});
      const raw=await client.request('classify',payload);
      if(!alive.current||auth.snapshot().user?.uid!==uid)throw Error('Your account changed. Open the map action again from Delta.');
      const result=validateMapAnalysisResponse(raw,payload.videos);
      await bridge.complete(result);if(alive.current){setComplete(true);setTerminal(true);}
    }catch(value){if(alive.current){setError(value.status===429?'Your free allowance or the model quota is unavailable. Your local records are kept.':value.message||'Map analysis did not finish. Your local records are kept.');setTerminal(true);}await bridge.fail(value).catch(()=>{});
    }finally{running.current=false;if(alive.current)setBusy(false);void auth.refreshSession().catch(()=>{});}
  }
  return <section className="study-workspace"><StudyAccount auth={auth} state={account}/><header className="study-heading"><div><span className="study-kicker">DELTA · MY MAP</span><h1>Organise your selected videos.</h1><p>Only the selected public titles and channels are sent for AI classification. Your viewing times and account credentials stay out of the extension handoff.</p></div></header>
    <p>{payload.videos.length} selected {payload.videos.length===1?'video':'videos'} · classification uses your remaining lifetime AI allowance.</p>
    <ul>{payload.videos.map(video=><li key={video.videoId}>{video.title}{video.channel?` · ${video.channel}`:''}</li>)}</ul>
    {error&&<p className="study-error" role="alert">{error} Return to the extension to open a new action.</p>}
    {complete?<p role="status">Your map results were returned to the Delta extension. You can close this tab.</p>:<button className="study-primary" type="button" disabled={busy||terminal||account.status!=='signed-in'||!account.quota?.remainingUsd} onClick={classify}>{busy?'Analysing selected metadata…':'Analyze selected videos'}</button>}
  </section>;
}
