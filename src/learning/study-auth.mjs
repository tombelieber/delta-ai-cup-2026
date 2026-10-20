import {createStudyClient,studyVideoId} from './study-client.mjs';
import {readStudyAuthConfig} from './study-auth-config.mjs';
import {awaitStudyAuthOperation,STUDY_AUTH_DEADLINE_MS,studyAuthCancelled} from './study-auth-deadline.mjs';

async function loadFirebaseSDK(){
  // The extension build removes this branch and the web-only popup SDK entirely.
  if(typeof __DELTA_EXTENSION__!=='undefined'&&__DELTA_EXTENSION__)throw Error('Use the learning website to sign in with Google.');
  const {initializeApp,getApps}=await import('firebase/app');
  const {initializeAuth,browserSessionPersistence,browserPopupRedirectResolver,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut,getIdToken}=await import('firebase/auth');
  return {initializeApp,getApps,initializeAuth,browserSessionPersistence,browserPopupRedirectResolver,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut,getIdToken};
}

export function studyAuthMessage(error){
  if(error?.code==='auth/popup-blocked')return 'Allow Google sign-in popups for this page, then try again.';
  if(['auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(error?.code))return 'Google sign-in did not finish. Your saved learning is kept. Try again.';
  if(error?.code==='study_auth_timeout')return 'Google sign-in timed out. Your saved learning is kept. Try again.';
  if(error?.code==='auth/unauthorized-domain')return 'Google sign-in is not enabled for this website yet.';
  if(error?.code==='auth/web-storage-unsupported')return 'Allow session storage in this browser to sign in with Google.';
  return 'Google sign-in or account credit could not be verified. Try again.';
}

const publicUser=user=>({uid:user.uid,...(user.displayName?{displayName:user.displayName}:{})});
const validQuota=value=>value&&['limitUsd','reservedUsd','spentUsd','remainingUsd'].every(key=>Number.isFinite(value[key])&&value[key]>=0)&&value.limitUsd>0&&value.remainingUsd<=value.limitUsd;

export function createStudyAuth({endpoint='',fetchImpl=globalThis.fetch,mockSDK=null,loadSDK=loadFirebaseSDK,location=globalThis.location,authConfig=null,sourceVideo=null,deadlineMs=STUDY_AUTH_DEADLINE_MS}={}){
  const origin=endpoint.replace(/\/$/,''),listeners=new Set();
  const native=location?.protocol==='chrome-extension:'||(typeof __DELTA_EXTENSION__!=='undefined'&&__DELTA_EXTENSION__);
  let webUrl='';try{const url=new URL('/learn?study=1',origin||location?.origin),videoId=studyVideoId(sourceVideo);if(videoId)url.searchParams.set('videoId',videoId);if(['https:','http:'].includes(url.protocol))webUrl=url.href;}catch{}
  let state={status:'loading',enabled:null,user:null,quota:null,limitUsd:null,error:'',webUrl,needsSignIn:false,entitlements:null,importsStatus:'idle'};
  let initialization=null,lifetimeController=null,sdk=null,firebaseAuth=null,stopObserver=null,revision=0,lifecycle=0,allowedUid='',sessionRequest=null,entitlementRevision=0;
  let signInRequest=null,signInRevision=0,admitObserver=true;
  const publish=next=>{state={...state,...next};for(const listener of listeners)listener(state);};
  const failChanged=()=>Object.assign(Error('Your Google account changed. Sign in to continue.'),{code:'study_auth_required'});
  const wait=(operation,phase,signal=lifetimeController?.signal)=>awaitStudyAuthOperation(operation,{phase,signal,timeoutMs:deadlineMs[phase]??STUDY_AUTH_DEADLINE_MS[phase]});
  const cancelSignIn=()=>{signInRevision++;signInRequest?.controller.abort();signInRequest=null;};

  async function getToken(expectedUid){
    const user=firebaseAuth?.currentUser,serial=revision;
    if(!user||!allowedUid||user.uid!==allowedUid||expectedUid!==user.uid)throw failChanged();
    const token=await wait(()=>sdk.getIdToken(user),'token');
    if(serial!==revision||firebaseAuth.currentUser?.uid!==expectedUid||allowedUid!==expectedUid||typeof token!=='string'||!token)throw failChanged();
    return token;
  }
  async function refreshSession(){
    const uid=allowedUid,serial=revision;
    if(!uid)throw failChanged();
    if(sessionRequest?.uid===uid&&sessionRequest.revision===serial)return sessionRequest.promise;
    const promise=(async()=>{
      try{
        const client=createStudyClient({endpoint:origin,userId:uid,getToken:()=>getToken(uid),fetchImpl});
        const result=await client.session();
        if(serial!==revision||uid!==allowedUid)return;
        if(result?.user?.uid!==uid||!validQuota(result.quota))throw Object.assign(Error('Invalid account session.'),{code:'session_identity_mismatch'});
        publish({status:'signed-in',user:publicUser({...result.user,displayName:result.user.displayName||firebaseAuth.currentUser?.displayName}),quota:result.quota,error:'',needsSignIn:false});
        return result;
      }catch(error){
        if(serial!==revision||uid!==allowedUid)return;
        if(state.status==='signed-in'&&firebaseAuth.currentUser?.uid===uid&&error.code!=='session_identity_mismatch')publish({quota:null,error:studyAuthMessage(error),needsSignIn:[401,403].includes(error.status)||error.code?.startsWith('auth/')||false});
        else{allowedUid='';publish({status:'signed-out',user:null,quota:null,error:studyAuthMessage(error)});}
        throw error;
      }finally{if(sessionRequest?.promise===promise)sessionRequest=null;}
    })();
    sessionRequest={uid,revision:serial,promise};return promise;
  }
  async function refreshEntitlements(){
    const uid=allowedUid,serial=revision,request=++entitlementRevision;if(!uid)throw failChanged();
    publish({entitlements:null,importsStatus:'loading'});
    try{const client=createStudyClient({endpoint:origin,userId:uid,getToken:()=>getToken(uid),fetchImpl});
      const result=await client.entitlements();if(serial!==revision||uid!==allowedUid||request!==entitlementRevision)return;
      publish({entitlements:result,importsStatus:'ready'});return result;
    }catch(error){if(serial===revision&&uid===allowedUid&&request===entitlementRevision)publish({entitlements:null,importsStatus:'unavailable'});throw error;}
  }
  async function observeUser(user){
    const sameUser=user&&allowedUid===user.uid&&state.user?.uid===user.uid&&state.status==='signed-in';
    revision++;sessionRequest=null;allowedUid=user?.uid||'';publish({entitlements:null,importsStatus:'idle'});
    if(!user){publish({status:'signed-out',user:null,quota:null,error:'',needsSignIn:false});return;}
    publish({...(sameUser?{}:{status:'verifying',user:null}),quota:null,error:'',needsSignIn:false});
    try{await refreshSession();}catch{}
  }
  async function initialize(){
    if(initialization)return initialization;
    stopObserver?.();stopObserver=null;lifetimeController?.abort();
    const controller=new AbortController();lifetimeController=controller;
    const serial=++revision,instance=++lifecycle;publish({status:'loading',user:null,quota:null,error:'',needsSignIn:false});
    const promise=(async()=>{
      try{
        let config=authConfig;
        if(!config)config=await readStudyAuthConfig({endpoint:origin,fetchImpl,signal:controller.signal});
        if(serial!==revision)return;
        if(config?.enabled===false){publish({status:'local',enabled:false});return;}
        if(config?.enabled!==true||!config.firebase||!['apiKey','authDomain','projectId','appId'].every(key=>typeof config.firebase[key]==='string'&&config.firebase[key])||!Number.isFinite(config.limitUsd)||config.limitUsd<=0)throw Error('Authentication configuration incomplete.');
        publish({enabled:true,limitUsd:config.limitUsd,webUrl});
        if(native){publish({status:'web-required'});return;}
        const loaded=mockSDK||await wait(loadSDK,'sdk',controller.signal);if(instance!==lifecycle||controller.signal.aborted)return;
        sdk=loaded;
        const name=`delta-study-${config.firebase.projectId}`,app=sdk.getApps().find(value=>value.name===name)||sdk.initializeApp(config.firebase,name);
        firebaseAuth=sdk.initializeAuth(app,{persistence:sdk.browserSessionPersistence,popupRedirectResolver:sdk.browserPopupRedirectResolver});
        const first=await wait(()=>new Promise((resolve,reject)=>{
          stopObserver=sdk.onAuthStateChanged(firebaseAuth,user=>{
            if(instance!==lifecycle||controller.signal.aborted){resolve({});return;}
            // Resolve the delivery separately from token/session verification so
            // each wait has its own deadline and later observer events stay live.
            const observation=observeUser(admitObserver?user:null);resolve({observation});
          },()=>{
            if(instance!==lifecycle||controller.signal.aborted)return;
            revision++;allowedUid='';sessionRequest=null;initialization=null;
            stopObserver?.();stopObserver=null;controller.abort();
            publish({status:'error',user:null,quota:null,error:'Google sign-in could not be opened. Try again.'});
            reject(Error('Google sign-in could not be opened. Try again.'));
          });
        }),'observer',controller.signal);
        await first.observation;
      }catch(error){
        if(instance===lifecycle&&!controller.signal.aborted){
          stopObserver?.();stopObserver=null;controller.abort();
          publish(native&&webUrl?{status:'web-required',user:null,quota:null,error:''}:{status:'error',user:null,quota:null,error:studyAuthMessage(error)});
        }
      }
    })();
    initialization=promise;await promise;
    if(state.status==='error'&&initialization===promise)initialization=null;
  }
  return {
    snapshot:()=>state,
    subscribe(listener){listeners.add(listener);listener(state);return()=>listeners.delete(listener);},
    initialize,refreshSession,refreshEntitlements,getToken,
    signIn(){
      if(signInRequest)return signInRequest.promise;
      const controller=new AbortController(),attempt=++signInRevision,request={controller,promise:null};
      const pending=(async()=>{
        await initialize();
        if(attempt!==signInRevision||controller.signal.aborted)throw studyAuthCancelled();
        if(!sdk||state.status==='web-required')throw Error('Open the learning website to sign in with Google.');
        if(state.status==='error')throw Error('Google sign-in could not be opened. Try again.');
        const instance=lifecycle,signal=AbortSignal.any([controller.signal,lifetimeController.signal]);
        const provider=new sdk.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});admitObserver=true;
        const result=await wait(()=>sdk.signInWithPopup(firebaseAuth,provider),'popup',signal);
        if(instance!==lifecycle||attempt!==signInRevision||signal.aborted)throw studyAuthCancelled();
        const uid=result?.user?.uid;
        if(!uid||firebaseAuth.currentUser?.uid!==uid)throw failChanged();
        if(allowedUid!==uid)await observeUser(result.user);
        else await refreshSession();
        if(instance!==lifecycle||attempt!==signInRevision||signal.aborted)throw studyAuthCancelled();
      })();
      request.promise=pending.finally(()=>{if(signInRequest===request)signInRequest=null;});
      signInRequest=request;return request.promise;
    },
    async signOut(){admitObserver=false;cancelSignIn();publish({entitlements:null,importsStatus:'idle'});revision++;allowedUid='';sessionRequest=null;publish({status:'signed-out',user:null,quota:null,error:'',needsSignIn:false});await sdk.signOut(firebaseAuth);},
    dispose(){revision++;lifecycle++;cancelSignIn();lifetimeController?.abort();lifetimeController=null;allowedUid='';stopObserver?.();stopObserver=null;initialization=null;sessionRequest=null;state={...state,status:'loading',user:null,quota:null,entitlements:null,importsStatus:'idle'};},
  };
}
