import React,{useState} from 'react';
import StudyImportAllowance from './StudyImportAllowance.jsx';
import {studyAuthMessage} from './study-auth.mjs';

export default function StudyAccount({auth,state}){
  const [working,setWorking]=useState(false),[error,setError]=useState('');
  if(state.status==='local')return null;
  async function perform(action){if(working)return;setWorking(true);setError('');try{await action();}catch(value){setError(studyAuthMessage(value));}finally{setWorking(false);}}
  const loading=['loading','verifying'].includes(state.status),quota=state.quota;
  const variant=loading?'loading':state.status==='signed-in'?'signed-in':state.status==='web-required'?'web-required':'signed-out';
  return <section className={`study-account study-account--${variant}`} data-status={state.status} aria-label="Google account and lifetime AI credit" aria-busy={loading||working}>
    {loading?<><span className="study-account-progress" aria-hidden="true"/><p role="status">{state.status==='verifying'?'Verifying your Google account and AI credit…':'Opening the learning service…'}</p></>:state.status==='web-required'?<>
      <div className="study-account-intro"><strong>Continue learning on the website.</strong><p>Google sign-in opens in a browser tab. Your website and extension libraries stay separate.</p></div>
      {state.webUrl&&<a className="study-account-link" href={state.webUrl} target="_blank" rel="noreferrer">{state.enabled?'Open learning lab and sign in with Google':'Open learning lab on the website'} ↗</a>}
    </>:state.status==='signed-in'?<>
      <div className="study-account-identity"><span className="study-account-avatar" aria-hidden="true">{(state.user.displayName||'Google').trim().slice(0,1).toUpperCase()}</span><span className="study-account-name"><strong>{state.user.displayName||'Signed in with Google'}</strong><small>Google account</small></span></div>
      <div className="study-account-budget">{quota?<><span>AI budget</span><strong>US${quota.remainingUsd.toFixed(4)}</strong><span>remaining</span></>:<span>AI budget unavailable</span>}</div>
      <details className="study-account-details"><summary>Budget details</summary><div><p>{quota?<>Estimated lifetime AI dispatch budget: <strong>US${quota.remainingUsd.toFixed(4)} remaining</strong> of US${quota.limitUsd.toFixed(2)}.</>:'The estimated AI budget is unavailable. Saved lessons, practice and exports remain available.'}</p><p>Conservative dispatch estimates, not a provider invoice. No daily reset. Each lesson is checked against US$0.10.</p><p>Your learning library stays on this device for your Google account.</p></div></details>
      <StudyImportAllowance auth={auth} state={state}/>
      <div className="study-account-actions">{!quota&&<button type="button" disabled={working} onClick={()=>perform(()=>state.needsSignIn?auth.signIn():auth.refreshSession())}>{state.needsSignIn?'Sign in again with Google':'Refresh account credit'}</button>}<button type="button" disabled={working} onClick={()=>perform(()=>auth.signOut())}>{working?'Signing out…':'Sign out'}</button></div>
    </>:<>
      <div className="study-welcome"><span className="study-account-eyebrow">LEARN IT. KEEP IT.</span><h1 className="study-welcome-title">Turn a video into something you can use.</h1><p className="study-welcome-copy">Create a source-linked lesson, put it into practice, recall what you saved and take a PowerPoint with you.</p><p className="study-welcome-outcomes">Lesson <span aria-hidden="true">→</span> Practice <span aria-hidden="true">→</span> Source recall <span aria-hidden="true">→</span> PPTX</p>
        <div className="study-welcome-actions"><a className="study-welcome-install study-primary" href="#install-extension">Install Delta <span aria-hidden="true">↗</span></a><div className="study-welcome-browser"><button type="button" disabled={working} onClick={()=>perform(()=>state.status==='error'?auth.initialize():auth.signIn())}>{working?'Connecting…':state.status==='error'?'Reconnect learning service':'Sign in with Google'}</button><span>Try in browser with prepared examples or your captions.</span></div></div>
        <p className="study-welcome-note">US${Number(state.limitUsd||.5).toFixed(2)} free AI allowance and ten lifetime history imports. Your learning library stays on this device for your Google account.</p>
        <ol className="study-welcome-steps"><li><strong>Install the Chrome pilot</strong><span>Download, unzip and load it in Developer mode.</span></li><li><strong>Open a captioned YouTube video</strong><span>Choose an available transcript excerpt of up to five minutes.</span></li><li><strong>Choose Learn in Delta</strong><span>Continue on the learning website and sign in with Google.</span></li></ol>
        <p className="study-welcome-note">Unpacked developer-mode pilot, not a Chrome Web Store release. Captions are required; availability varies by video. Learning uses supported excerpts of up to five minutes.</p>
        <details className="study-account-details"><summary>About your free allowance</summary><div><p>US${Number(state.limitUsd||.5).toFixed(2)} estimated lifetime AI dispatch budget, with no daily reset. Conservative dispatch estimates are not a provider invoice. Each lesson is checked against US$0.10.</p><p>Saved learning stays in this browser, separated by Google account.</p></div></details>
      </div>
    </>}
    {(error||state.error)&&<p className="study-account-error" role="alert">{error||state.error}</p>}
  </section>;
}
