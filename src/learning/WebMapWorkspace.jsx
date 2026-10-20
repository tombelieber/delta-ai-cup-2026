import React,{useEffect,useMemo,useRef,useState} from 'react';
import PersonalUniverse from '../../extension/PersonalUniverse.jsx';
import StudyAccount from './StudyAccount.jsx';
import {createStudyAuth} from './study-auth.mjs';
import {createWebMapClient} from './web-map-client.mjs';
import './study.css';

export default function WebMapWorkspace({endpoint='',authConfig}={}){
  const auth=useMemo(()=>createStudyAuth({endpoint,authConfig}),[endpoint,authConfig]);
  const [snapshot,setSnapshot]=useState(()=>({auth,state:auth.snapshot()}));
  const account=snapshot.auth===auth?snapshot.state:auth.snapshot();
  useEffect(()=>{const unsubscribe=auth.subscribe(state=>setSnapshot({auth,state}));void auth.initialize();return()=>{unsubscribe();auth.dispose();};},[auth]);
  return <section className="study-workspace"><StudyAccount auth={auth} state={account}/>
    {account.status==='signed-in'?<WebMapContent key={`${endpoint}:${account.user.uid}`} auth={auth} account={account} uid={account.user.uid} endpoint={endpoint||location.origin}/>
      :account.status==='local'?<p role="status">Open My Map on the hosted Delta website and sign in with Google.</p>:null}
  </section>;
}

function WebMapContent({auth,account,uid,endpoint}){
  const [range,setRange]=useState('all'),[journal,setJournal]=useState(null),[error,setError]=useState(''),[importing,setImporting]=useState(false),[funding,setFunding]=useState('free'),[analysing,setAnalysing]=useState(false);
  const fundingRef=useRef(funding);fundingRef.current=funding;
  const lifetime=useRef(0);
  const connection=useMemo(()=>{try{return {client:createWebMapClient({uid,auth,endpoint,readFunding:()=>fundingRef.current})};}catch(issue){return {error:issue.message};}},[uid,auth,endpoint]);
  useEffect(()=>{const serial=++lifetime.current;setJournal(null);setError(connection.error||'');
    if(connection.client)connection.client.journal().then(value=>{if(serial===lifetime.current)setJournal(value);}).catch(issue=>{if(serial===lifetime.current)setError(issue.message);});
    return()=>{lifetime.current++;connection.client?.destroy();};},[connection]);
  useEffect(()=>{let alive=true;const unsubscribe=connection.client?.subscribe(()=>{connection.client.get().then(value=>{if(alive)setAnalysing(value.status.state==='running');}).catch(()=>{});});return()=>{alive=false;unsubscribe?.();};},[connection]);
  async function importRecords(event){
    const input=event.currentTarget,file=input.files?.[0];if(!file||importing||!connection.client)return;
    const serial=lifetime.current;setImporting(true);setError('');
    try{
      if(file.size>250000)throw Error('Choose a metadata JSON file under 250 KB with at most 100 videos.');
      const value=JSON.parse(await file.text());
      if(serial!==lifetime.current)return;
      const next=await connection.client.importRecords(value);
      if(serial===lifetime.current)setJournal(next);
    }catch(issue){if(serial===lifetime.current)setError(issue instanceof SyntaxError?'Choose a valid Delta metadata JSON file. Nothing was imported.':issue.message||'The file could not be imported. Saved records are kept.');}
    finally{input.value='';if(serial===lifetime.current)setImporting(false);}
  }
  return <div style={{maxWidth:560,margin:'0 auto'}}>
    <p className="study-kicker">DELTA · WEBSITE MAP</p>
    <p>Import a private video metadata file from your YouTube history. Website records stay in this browser for your Google account. The website and extension libraries are separate; they do not sync automatically.</p>
    <label className="dpu-import">Import up to 100 video records<input type="file" accept=".json,application/json" onChange={importRecords} disabled={importing||!connection.client}/></label>
    <p>Your first 10 distinct imports are free. Additional imports require a purchased pack; re-importing the same video uses no additional slot. Only video IDs are sent to verify this allowance.</p>
    {account.entitlements?.paid?.classificationAvailable&&<label>Classification allowance<select value={funding} disabled={importing||analysing} onChange={event=>setFunding(event.target.value)}><option value="free">Use free AI credit</option><option value="paid">Use Starter Pack map allocation · no learning session used</option></select></label>}
    <p>{importing?'Verifying import allowance and saving metadata on this device…':'Importing makes no AI request. Choose Analyze new videos to organise the imported titles with Gemini.'}</p>
    {error&&<p role="alert" className="study-error">{error}</p>}
    <PersonalUniverse journal={journal} mapClient={connection.client} surface="web" timeRange={range} onTimeRangeChange={setRange} busy={importing}
      onLearn={videoId=>{location.href=`/learn?study=1&videoId=${encodeURIComponent(videoId)}`;}}/>
  </div>;
}
