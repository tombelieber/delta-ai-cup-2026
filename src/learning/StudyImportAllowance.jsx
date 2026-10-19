import React,{useEffect} from 'react';

export default function StudyImportAllowance({auth,state}){
  useEffect(()=>{if(state.status==='signed-in')void auth.refreshEntitlements().catch(()=>{});},[auth,state.status,state.user?.uid]);
  const imports=state.entitlements?.imports,loading=state.importsStatus==='loading';
  return <div className="study-import-allowance" aria-label="History import allowance" aria-busy={loading}>
    <div className="study-import-balance"><strong>History imports</strong>{imports?<span><b>{imports.remaining}</b> of {imports.limit} free imports left</span>:<span role="status">{loading?'Checking your allowance…':'Allowance unavailable'}</span>}</div>
    {imports&&<progress max={imports.limit} value={imports.used} aria-label={`${imports.used} of ${imports.limit} lifetime free history imports used`}/>}
    <p>{imports?.remaining===0?'Your free imports are used. Saved history, lessons and exports stay available.':'Ten distinct videos per account, across all imports. Re-importing the same video uses no additional import.'}</p>
    {!imports&&!loading&&<button type="button" onClick={()=>void auth.refreshEntitlements().catch(()=>{})}>Check import allowance</button>}
    <details className="study-account-details"><summary>Need more imports?</summary><p><strong>Starter Pack · US$5 once</strong><br/>100 additional history imports and 20 learning sessions. Up to five minutes of captions per session, with teaching cards, exercises, two follow-up questions and PPTX.</p><p>Not on sale yet. No payment is taken. Your free AI credit is separate from history imports.</p></details>
  </div>;
}
