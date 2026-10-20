import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudyAuth,studyAuthMessage} from '../src/learning/study-auth.mjs';
import {awaitStudyAuthOperation,STUDY_AUTH_DEADLINE_MS} from '../src/learning/study-auth-deadline.mjs';

const config={enabled:true,firebase:{apiKey:'public-test-key',authDomain:'delta.example',projectId:'deadline-test',appId:'public-test-app'},limitUsd:.5};
const quota={limitUsd:.5,reservedUsd:0,spentUsd:0,remainingUsd:.5};
const user=uid=>({uid,displayName:uid});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deadlineMs={sdk:10,observer:10,token:10,popup:10};
async function bounded(promise){
  let timer;
  try{return await Promise.race([promise.then(value=>({settled:true,value}),error=>({settled:true,error})),new Promise(resolve=>{timer=setTimeout(()=>resolve({settled:false}),300);})]);}
  finally{clearTimeout(timer);}
}
function fixture(initial=null){
  const auth={currentUser:initial};let observer,observerError,stops=0,popups=0,requests=0;
  const popup=deferred();
  const sdk={browserSessionPersistence:{type:'SESSION'},browserPopupRedirectResolver:{type:'POPUP'},getApps:()=>[],initializeApp:()=>({}),initializeAuth:()=>auth,
    onAuthStateChanged(_auth,next,error){observer=next;observerError=error;queueMicrotask(()=>next(auth.currentUser));return()=>{observer=null;observerError=null;stops++;};},
    GoogleAuthProvider:class{setCustomParameters(){}},getIdToken:async()=> 'unit-test-token',
    signInWithPopup(){popups++;return popup.promise;},signOut:async()=>{auth.currentUser=null;observer?.(null);}};
  const fetchImpl=async()=>{requests++;return new Response(JSON.stringify({user:{uid:auth.currentUser?.uid},quota}));};
  const create=options=>createStudyAuth({authConfig:config,mockSDK:sdk,fetchImpl,deadlineMs,...options});
  return {auth,sdk,popup,create,get stops(){return stops;},get popups(){return popups;},get requests(){return requests;},
    setUser(value){auth.currentUser=value;observer?.(value);},failObserver(){observerError?.(Error('Synthetic observer failure.'));}};
}

test('production SDK, observer and token waits are 20 seconds; the popup wait is 60 seconds',()=>{
  assert.deepEqual(STUDY_AUTH_DEADLINE_MS,{sdk:20000,observer:20000,token:20000,popup:60000});
  assert.equal(Object.isFrozen(STUDY_AUTH_DEADLINE_MS),true);
});

test('an already canceled lifecycle does not start the SDK operation',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(awaitStudyAuthOperation(()=>{calls++;},{signal:controller.signal,phase:'popup'}),{code:'study_auth_cancelled'});
  assert.equal(calls,0);
});

test('a stalled Firebase SDK load ends with a recoverable error',async()=>{
  const stalled=deferred(),f=fixture(),auth=f.create({mockSDK:null,loadSDK:()=>stalled.promise});
  const result=await bounded(auth.initialize());
  assert.equal(result.settled,true);assert.equal(auth.snapshot().status,'error');assert.match(auth.snapshot().error,/timed out/i);
  auth.dispose();stalled.resolve(f.sdk);await tick();assert.equal(auth.snapshot().user,null);
});

test('a missing first Firebase observer delivery times out and detaches before reconnect',async()=>{
  const f=fixture();f.sdk.onAuthStateChanged=()=>()=>{f.detached=(f.detached||0)+1;};
  const auth=f.create(),result=await bounded(auth.initialize());
  assert.equal(result.settled,true);assert.equal(auth.snapshot().status,'error');assert.equal(f.detached,1);
  f.sdk.onAuthStateChanged=(_auth,next)=>{queueMicrotask(()=>next(null));return()=>{};};
  await auth.initialize();assert.equal(auth.snapshot().status,'signed-out');auth.dispose();
});

test('a queued observer delivery from a timed-out initialization cannot expose an account',async()=>{
  const f=fixture();let deliver;f.sdk.onAuthStateChanged=(_auth,next)=>{deliver=next;return()=>{};};
  const auth=f.create();await auth.initialize();assert.equal(auth.snapshot().status,'error');
  f.auth.currentUser=user('alice');deliver(f.auth.currentUser);await tick();
  assert.equal(auth.snapshot().status,'error');assert.equal(auth.snapshot().user,null);assert.equal(f.requests,0);auth.dispose();
});

test('an observer error after initial delivery fails closed and allows explicit reconnect',async()=>{
  const f=fixture(user('alice')),auth=f.create();await auth.initialize();f.failObserver();
  assert.equal(auth.snapshot().status,'error');assert.equal(auth.snapshot().user,null);
  await assert.rejects(auth.getToken('alice'),{code:'study_auth_required'});
  await auth.initialize();assert.equal(auth.snapshot().status,'signed-in');assert.equal(auth.snapshot().user.uid,'alice');assert.equal(f.stops,1);auth.dispose();
});

test('a stalled token cannot leave initial account verification pending or issue a session request',async()=>{
  const stalled=deferred(),f=fixture(user('alice'));f.sdk.getIdToken=()=>stalled.promise;
  const auth=f.create(),result=await bounded(auth.initialize());
  assert.equal(result.settled,true);assert.equal(auth.snapshot().status,'signed-out');assert.equal(f.requests,0);
  assert.match(auth.snapshot().error,/timed out/i);stalled.resolve('late-unit-token');await tick();
  assert.equal(f.requests,0);assert.equal(auth.snapshot().user,null);auth.dispose();
});

test('a stalled same-account token refresh preserves its library identity and pauses account credit',async()=>{
  const f=fixture(user('alice')),auth=f.create();await auth.initialize();
  f.sdk.getIdToken=()=>new Promise(()=>{});
  const result=await bounded(auth.refreshSession());
  assert.equal(result.settled,true);assert.equal(result.error?.code,'study_auth_timeout');
  assert.equal(auth.snapshot().status,'signed-in');assert.equal(auth.snapshot().user.uid,'alice');assert.equal(auth.snapshot().quota,null);auth.dispose();
});

test('a stalled Google popup stops Connecting without retrying the provider automatically',async()=>{
  const f=fixture(),auth=f.create();await auth.initialize();
  const result=await bounded(auth.signIn());
  assert.equal(result.settled,true);assert.equal(result.error?.code,'study_auth_timeout');assert.equal(result.error?.phase,'popup');
  assert.equal(f.popups,1);assert.equal(auth.snapshot().user,null);auth.dispose();
});

test('only an explicit new sign-in retries a timed-out popup',async()=>{
  const f=fixture(),auth=f.create();await auth.initialize();
  await assert.rejects(auth.signIn(),{code:'study_auth_timeout'});assert.equal(f.popups,1);
  const second=auth.signIn();await tick();assert.equal(f.popups,2);
  f.setUser(user('alice'));f.popup.resolve({user:f.auth.currentUser});await second;
  assert.equal(auth.snapshot().status,'signed-in');auth.dispose();
});

test('same-turn sign-in calls share one popup and one promise',async()=>{
  const f=fixture(),auth=f.create({deadlineMs:{...deadlineMs,popup:200}});await auth.initialize();
  const first=auth.signIn(),second=auth.signIn();assert.equal(first,second);await tick();assert.equal(f.popups,1);
  f.setUser(user('alice'));f.popup.resolve({user:f.auth.currentUser});await first;
  assert.equal(auth.snapshot().user.uid,'alice');auth.dispose();
});

test('disposing a missing observer promptly settles initialization and detaches the observer',async()=>{
  const f=fixture();f.sdk.onAuthStateChanged=()=>()=>{f.detached=(f.detached||0)+1;};
  const auth=f.create({deadlineMs:{...deadlineMs,observer:60000}}),pending=auth.initialize();await tick();auth.dispose();
  const result=await bounded(pending);assert.equal(result.settled,true);assert.equal(f.detached,1);assert.equal(auth.snapshot().status,'loading');
});

test('dispose cancels a popup wait and its late result cannot expose an account',async()=>{
  const f=fixture(),auth=f.create({deadlineMs:{...deadlineMs,popup:60000}});await auth.initialize();
  const pending=auth.signIn();await tick();auth.dispose();const result=await bounded(pending);
  assert.equal(result.settled,true);assert.equal(result.error?.code,'study_auth_cancelled');
  f.setUser(user('alice'));f.popup.resolve({user:f.auth.currentUser});await tick();
  assert.equal(auth.snapshot().status,'loading');assert.equal(auth.snapshot().user,null);assert.equal(f.requests,0);
});

test('a late SDK load from an old lifecycle cannot replace the reconnected auth instance',async()=>{
  const stalled=deferred(),old=fixture(user('alice')),current=fixture(user('bob'));let loads=0;
  const auth=current.create({mockSDK:null,loadSDK:()=>++loads===1?stalled.promise:Promise.resolve(current.sdk),deadlineMs:{...deadlineMs,sdk:60000}});
  const first=auth.initialize();auth.dispose();await first;await auth.initialize();
  assert.equal(auth.snapshot().user.uid,'bob');stalled.resolve(old.sdk);await tick();
  assert.equal(auth.snapshot().user.uid,'bob');assert.equal(await auth.getToken('bob'),'unit-test-token');auth.dispose();
});

test('a late popup and observer after explicit sign-out cannot restore the signed-out library',async()=>{
  const f=fixture(),auth=f.create({deadlineMs:{...deadlineMs,popup:60000}});await auth.initialize();
  const pending=auth.signIn();await tick();await auth.signOut();const result=await bounded(pending);
  assert.equal(result.settled,true);assert.equal(result.error?.code,'study_auth_cancelled');
  f.setUser(user('alice'));f.popup.resolve({user:f.auth.currentUser});await tick();
  assert.equal(auth.snapshot().status,'signed-out');assert.equal(auth.snapshot().user,null);assert.equal(f.requests,0);auth.dispose();
});

test('reinitialization after sign-out stays signed out even if Firebase still has a late popup user',async()=>{
  const f=fixture(user('alice')),auth=f.create();await auth.initialize();await auth.signOut();
  f.auth.currentUser=user('alice');auth.dispose();await auth.initialize();
  assert.equal(auth.snapshot().status,'signed-out');assert.equal(auth.snapshot().user,null);assert.equal(f.requests,1);auth.dispose();
});

test('a timed-out popup may only recover through a current, server-verified auth observer',async()=>{
  const f=fixture(),auth=f.create();await auth.initialize();
  const result=await bounded(auth.signIn());assert.equal(result.error?.code,'study_auth_timeout');
  f.setUser(user('alice'));f.popup.resolve({user:f.auth.currentUser});await tick();
  assert.equal(auth.snapshot().status,'signed-in');assert.equal(auth.snapshot().user.uid,'alice');assert.equal(f.requests,1);auth.dispose();
});

test('a popup result for a different current Firebase account is rejected without exposing a library',async()=>{
  const f=fixture(),auth=f.create({deadlineMs:{...deadlineMs,popup:200}});await auth.initialize();
  const pending=auth.signIn();await tick();f.auth.currentUser=user('bob');f.popup.resolve({user:user('alice')});
  await assert.rejects(pending,{code:'study_auth_required'});assert.equal(auth.snapshot().user,null);assert.equal(f.requests,0);auth.dispose();
});

test('popup completion errors do not claim that a human closed the window',()=>{
  for(const code of ['auth/popup-closed-by-user','auth/cancelled-popup-request']){
    assert.match(studyAuthMessage({code}),/did not finish/i);assert.doesNotMatch(studyAuthMessage({code}),/was closed|you closed/i);
  }
});
