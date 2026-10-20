export const STUDY_AUTH_DEADLINE_MS=Object.freeze({sdk:20000,observer:20000,token:20000,popup:60000});

export function studyAuthCancelled(){
  return Object.assign(Error('This sign-in operation is no longer active.'),{code:'study_auth_cancelled'});
}

// Ending our wait does not cancel Firebase or change its credentials. The owner
// must still fence late SDK completion against the active lifecycle and user.
export function awaitStudyAuthOperation(operation,{signal,phase,timeoutMs=STUDY_AUTH_DEADLINE_MS[phase]}={}){
  return new Promise((resolve,reject)=>{
    let finished=false,timer;
    const complete=(callback,value)=>{
      if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
      callback(value);
    };
    const cancel=()=>complete(reject,studyAuthCancelled());
    if(signal?.aborted){cancel();return;}
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>complete(reject,Object.assign(Error('Google sign-in timed out.'),{code:'study_auth_timeout',phase})),timeoutMs);
    try{Promise.resolve(operation()).then(value=>complete(resolve,value),error=>complete(reject,error));}
    catch(error){complete(reject,error);}
  });
}
