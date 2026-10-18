import {createStudyClient,studyVideoId} from './study-client.mjs';

async function loadFirebaseSDK(){
  // The extension build removes this branch and the web-only popup SDK entirely.
  if(typeof __DELTA_EXTENSION__!=='undefined'&&__DELTA_EXTENSION__)throw Error('Use the learning website to sign in with Google.');
  const {initializeApp,getApps}=await import('firebase/app');
  const {initializeAuth,browserSessionPersistence,browserPopupRedirectResolver,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut,getIdToken}=await import('firebase/auth');
  return {initializeApp,getApps,initializeAuth,browserSessionPersistence,browserPopupRedirectResolver,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut,getIdToken};
}

export function studyAuthMessage(error){
  if(error?.code==='auth/popup-blocked')return 'Allow Google sign-in popups for this page, then try again.';
  if(['auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(error?.code))return 'Google sign-in was closed. Your saved learning is kept.';
  if(error?.code==='auth/unauthorized-domain')return 'Google sign-in is not enabled for this website yet.';
  if(error?.code==='auth/web-storage-unsupported')return 'Allow session storage in this browser to sign in with Google.';
  return 'Google sign-in or account credit could not be verified. Try again.';
}

const publicUser=user=>({uid:user.uid,...(user.displayName?{displayName:user.displayName}:{})});
const validQuota=value=>value&&['limitUsd','reservedUsd','spentUsd','remainingUsd'].every(key=>Number.isFinite(value[key])&&value[key]>=0)&&value.limitUsd>0&&value.remainingUsd<=value.limitUsd;

export function createStudyAuth({endpoint='',fetchImpl=globalThis.fetch,mockSDK=null,loadSDK=loadFirebaseSDK,location=globalThis.location,authConfig=null,sourceVideo=null}={}){
  const origin=endpoint.replace(/\/$/,''),listeners=new Set();
  const native=location?.protocol==='chrome-extension:'||(typeof __DELTA_EXTENSION__!=='undefined'&&__DELTA_EXTENSION__);
  let webUrl='';try{const url=new URL('/learn?study=1',origin||location?.origin),videoId=studyVideoId(sourceVideo);if(videoId)url.searchParams.set('videoId',videoId);if(['https:','http:'].includes(url.protocol))webUrl=url.href;}catch{}
  let state={status:'loading',enabled:null,user:null,quota:null,limitUsd:null,error:'',webUrl,needsSignIn:false};
  let initialization=null,sdk=null,firebaseAuth=null,stopObserver=null,revision=0,lifecycle=0,allowedUid='',sessionRequest=null;
  const publish=next=>{state={...state,...next};for(const listener of listeners)listener(state);};
  const failChanged=()=>Object.assign(Error('Your Google account changed. Sign in to continue.'),{code:'study_auth_required'});

  async function getToken(expectedUid){
    const user=firebaseAuth?.currentUser,serial=revision;
    if(!user||!allowedUid||user.uid!==allowedUid||expectedUid!==user.uid)throw failChanged();
    const token=await sdk.getIdToken(user);
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
  async function observeUser(user){
    const sameUser=user&&allowedUid===user.uid&&state.user?.uid===user.uid&&state.status==='signed-in';
    revision++;sessionRequest=null;allowedUid=user?.uid||'';
    if(!user){publish({status:'signed-out',user:null,quota:null,error:'',needsSignIn:false});return;}
    publish({...(sameUser?{}:{status:'verifying',user:null}),quota:null,error:'',needsSignIn:false});
    try{await refreshSession();}catch{}
  }
  async function initialize(){
    if(initialization)return initialization;
    const serial=++revision,instance=++lifecycle;publish({status:'loading',user:null,quota:null,error:'',needsSignIn:false});
    const promise=(async()=>{
      try{
        let config=authConfig;
        if(!config){const response=await fetchImpl(`${origin}/api/study/auth-config`,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
          if(!response.ok)throw Error('Authentication configuration unavailable.');config=await response.json();}
        if(serial!==revision)return;
        if(config?.enabled===false){publish({status:'local',enabled:false});return;}
        if(config?.enabled!==true||!config.firebase||!['apiKey','authDomain','projectId','appId'].every(key=>typeof config.firebase[key]==='string'&&config.firebase[key])||!Number.isFinite(config.limitUsd)||config.limitUsd<=0)throw Error('Authentication configuration incomplete.');
        publish({enabled:true,limitUsd:config.limitUsd,webUrl});
        if(native){publish({status:'web-required'});return;}
        sdk=mockSDK||await loadSDK();if(serial!==revision)return;
        const name=`delta-study-${config.firebase.projectId}`,app=sdk.getApps().find(value=>value.name===name)||sdk.initializeApp(config.firebase,name);
        firebaseAuth=sdk.initializeAuth(app,{persistence:sdk.browserSessionPersistence,popupRedirectResolver:sdk.browserPopupRedirectResolver});
        await new Promise(resolve=>{stopObserver=sdk.onAuthStateChanged(firebaseAuth,user=>{if(instance!==lifecycle){resolve();return;}void observeUser(user).finally(resolve);},()=>{if(instance===lifecycle)publish({status:'error',user:null,quota:null,error:'Google sign-in could not be opened. Try again.'});resolve();});});
      }catch(error){if(serial===revision)publish(native&&webUrl?{status:'web-required',user:null,quota:null,error:''}:{status:'error',user:null,quota:null,error:studyAuthMessage(error)});}
    })();
    initialization=promise;await promise;
    if(state.status==='error'&&initialization===promise)initialization=null;
  }
  return {
    snapshot:()=>state,
    subscribe(listener){listeners.add(listener);listener(state);return()=>listeners.delete(listener);},
    initialize,refreshSession,getToken,
    async signIn(){
      await initialize();
      if(!sdk||state.status==='web-required')throw Error('Open the learning website to sign in with Google.');
      const provider=new sdk.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
      const result=await sdk.signInWithPopup(firebaseAuth,provider);
      if(allowedUid!==result.user.uid){await observeUser(result.user);return;}
      await refreshSession();
    },
    async signOut(){revision++;allowedUid='';sessionRequest=null;publish({status:'signed-out',user:null,quota:null,error:'',needsSignIn:false});await sdk.signOut(firebaseAuth);},
    dispose(){revision++;lifecycle++;allowedUid='';stopObserver?.();stopObserver=null;initialization=null;sessionRequest=null;state={...state,status:'loading',user:null,quota:null};},
  };
}
