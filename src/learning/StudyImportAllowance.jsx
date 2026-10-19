import React,{useEffect} from 'react';

export default function StudyImportAllowance({auth,state}){
  useEffect(()=>{if(state.status==='signed-in')void auth.refreshEntitlements().catch(()=>{});},[auth,state.status,state.user?.uid]);
  const imports=state.entitlements?.imports,loading=state.importsStatus==='loading';
  return <div className="study-import-allowance" aria-label="History import allowance" aria-busy={loading}>
    <div className="study-import-balance"><strong>History imports</strong>{imports?<span><b>{imports.remaining}</b> of {imports.limit} imports left</span>:<span role="status">{loading?'Checking your allowance…':'Allowance unavailable'}</span>}</div>
    {imports&&<progress max={imports.limit} value={imports.used} aria-label={`${imports.used} of ${imports.limit} lifetime history imports used`}/>}
    <p>{imports?.remaining===0?'Your history allowance is used. Saved history, lessons and exports stay available.':'Your first ten distinct videos are free. Purchased packs add to this account allowance. Re-importing the same video uses no additional import.'}</p>
    {!imports&&!loading&&<button type="button" onClick={()=>void auth.refreshEntitlements().catch(()=>{})}>Check import allowance</button>}

  </div>;
}
