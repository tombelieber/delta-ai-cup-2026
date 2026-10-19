import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudyAuth} from '../src/learning/study-auth.mjs';

const config={enabled:true,firebase:{apiKey:'public-web-key',authDomain:'delta.example',projectId:'delta-test',appId:'public-app-id'},limitUsd:.5};
const quota={limitUsd:.5,reservedUsd:.01,spentUsd:.02,remainingUsd:.47};
const user=uid=>({uid,displayName:uid,providerData:[{providerId:'google.com'}],getIdToken:async()=>`firebase-id-${uid}`});
function sdkFixture(initial=null){
  const auth={currentUser:initial},calls=[];let observer;
  const sdk={browserSessionPersistence:{type:'SESSION'},browserPopupRedirectResolver:{type:'POPUP'},getApps:()=>[],initializeApp:()=>({name:'study'}),
    initializeAuth(app,options){calls.push(options);return auth;},
    onAuthStateChanged(value,callback){observer=callback;queueMicrotask(()=>callback(value.currentUser));return()=>{observer=null;};},
    GoogleAuthProvider:class{setCustomParameters(value){calls.push(value);}},
    signInWithPopup:async()=>{auth.currentUser=user('alice');observer?.(auth.currentUser);return {user:auth.currentUser};},
    getIdToken:value=>value.getIdToken(),signOut:async()=>{auth.currentUser=null;observer?.(null);}};
  return {sdk,auth,calls,setUser(value){auth.currentUser=value;observer?.(value);}};
}
function transport(configuration=config,sessionUser=null){
  return async(url,init)=>new Response(JSON.stringify(url.endsWith('/auth-config')?configuration:{user:{uid:sessionUser||new Headers(init.headers).get('authorization')?.replace('Bearer firebase-id-','')},quota}),{status:200});
}
test('local mode never initializes Firebase or adds an authentication requirement',async()=>{
  let loaded=0;const auth=createStudyAuth({fetchImpl:transport({enabled:false}),loadSDK:async()=>{loaded++;throw Error('unexpected SDK load');}});
  await auth.initialize();assert.equal(auth.snapshot().status,'local');assert.equal(loaded,0);auth.dispose();
});
test('web Google authentication uses session persistence and verifies the signed-in Firebase identity',async()=>{
  const fixture=sdkFixture(user('alice')),auth=createStudyAuth({mockSDK:fixture.sdk,fetchImpl:transport()});
  await auth.initialize();
  assert.equal(fixture.calls[0].persistence,fixture.sdk.browserSessionPersistence);
  assert.equal(auth.snapshot().status,'signed-in');assert.equal(auth.snapshot().user.uid,'alice');
  assert.deepEqual(auth.snapshot().quota,quota);assert.equal(await auth.getToken('alice'),'firebase-id-alice');
  assert.equal(JSON.stringify(auth.snapshot()).includes('firebase-id-alice'),false);auth.dispose();
});
test('a mismatched authenticated session cannot expose a Firebase user library',async()=>{
  const fixture=sdkFixture(user('alice')),auth=createStudyAuth({mockSDK:fixture.sdk,fetchImpl:transport(config,'bob')});
  await auth.initialize();assert.notEqual(auth.snapshot().status,'signed-in');assert.equal(auth.snapshot().user,null);auth.dispose();
});
test('sign-out hides the current account before the SDK finishes',async()=>{
  const fixture=sdkFixture(user('alice'));let finish;
  fixture.sdk.signOut=()=>new Promise(resolve=>{finish=resolve;});
  const auth=createStudyAuth({mockSDK:fixture.sdk,fetchImpl:transport()});await auth.initialize();
  const pending=auth.signOut();assert.equal(auth.snapshot().user,null);assert.equal(auth.snapshot().status,'signed-out');
  await assert.rejects(auth.getToken('alice'),/sign in|changed/i);finish();await pending;auth.dispose();
});
test('account switches reject a token that finishes resolving for the previous user',async()=>{
  const alice=user('alice'),fixture=sdkFixture(alice),auth=createStudyAuth({mockSDK:fixture.sdk,fetchImpl:transport()});await auth.initialize();
  let finish;alice.getIdToken=()=>new Promise(resolve=>{finish=resolve;});
  const pending=auth.getToken('alice');fixture.setUser(user('bob'));finish('firebase-id-alice');
  await assert.rejects(pending,/sign in|changed/i);await auth.refreshSession();assert.equal(auth.snapshot().user.uid,'bob');auth.dispose();
});
test('native Google mode offers a token-free web route without loading the popup SDK',async()=>{
  let loaded=0;const auth=createStudyAuth({endpoint:'https://delta.example',location:{protocol:'chrome-extension:',origin:'chrome-extension://test'},fetchImpl:transport(),loadSDK:async()=>{loaded++;throw Error('unexpected SDK load');}});
  await auth.initialize();assert.equal(auth.snapshot().status,'web-required');assert.equal(auth.snapshot().webUrl,'https://delta.example/learn?study=1');assert.equal(loaded,0);auth.dispose();
});
test('a same-account authentication error preserves its local-library identity and pauses AI credit',async()=>{
  const fixture=sdkFixture(user('alice'));let denied=false;
  const auth=createStudyAuth({mockSDK:fixture.sdk,fetchImpl:(url,init)=>denied&&url.endsWith('/session')?Promise.resolve(new Response(JSON.stringify({error:'study_auth_required'}),{status:401})):transport()(url,init)});
  await auth.initialize();denied=true;await assert.rejects(auth.refreshSession());
  assert.equal(auth.snapshot().status,'signed-in');assert.equal(auth.snapshot().user.uid,'alice');assert.equal(auth.snapshot().quota,null);assert.equal(auth.snapshot().needsSignIn,true);auth.dispose();
});
test('Google popup sign-in verifies the returned account without extracting provider access tokens',async()=>{
  const fixture=sdkFixture(),auth=createStudyAuth({mockSDK:fixture.sdk,fetchImpl:transport()});await auth.initialize();
  assert.equal(auth.snapshot().status,'signed-out');await auth.signIn();
  assert.equal(auth.snapshot().status,'signed-in');assert.equal(auth.snapshot().user.uid,'alice');
  assert.deepEqual(fixture.calls.at(-1),{prompt:'select_account'});auth.dispose();
});
test('native callers denied by the website origin boundary still receive a safe web fallback',async()=>{
  const auth=createStudyAuth({endpoint:'https://delta.example',location:{protocol:'chrome-extension:',origin:'chrome-extension://test'},fetchImpl:async()=>new Response('{}',{status:403})});
  await auth.initialize();assert.equal(auth.snapshot().status,'web-required');assert.equal(auth.snapshot().webUrl,'https://delta.example/learn?study=1');auth.dispose();
});
test('the selected YouTube video survives the native Google sign-in fallback',async()=>{
  const auth=createStudyAuth({endpoint:'https://delta.example',sourceVideo:{videoId:'abcdefghijk'},location:{protocol:'chrome-extension:',origin:'chrome-extension://test'},fetchImpl:transport()});
  await auth.initialize();assert.equal(auth.snapshot().webUrl,'https://delta.example/learn?study=1&videoId=abcdefghijk');auth.dispose();
});
test('the normal web entry reuses its verified auth configuration without a second configuration fetch',async()=>{
  const fixture=sdkFixture(user('alice')),urls=[];
  const auth=createStudyAuth({authConfig:config,mockSDK:fixture.sdk,fetchImpl:async(url,init)=>{urls.push(url);return transport()(url,init);}});
  await auth.initialize();assert.equal(auth.snapshot().status,'signed-in');assert.deepEqual(urls,['/api/study/session']);auth.dispose();
});

test('import balance is separate from AI credit and a late response cannot cross accounts',async()=>{
  const fixture=sdkFixture(user('alice'));let finish;
  const auth=createStudyAuth({mockSDK:fixture.sdk,fetchImpl:(url,init)=>url.endsWith('/entitlements')?new Promise(resolve=>{finish=()=>resolve(new Response(JSON.stringify({schemaVersion:1,imports:{limit:10,used:3,remaining:7},starterPack:{priceUsd:5,additionalImports:100,studySessions:20,available:false}})));}):transport()(url,init)});
  await auth.initialize();const pending=auth.refreshEntitlements();await new Promise(resolve=>setImmediate(resolve));
  fixture.setUser(user('bob'));finish();await pending;await auth.refreshSession();
  assert.equal(auth.snapshot().user.uid,'bob');assert.equal(auth.snapshot().entitlements,null);assert.deepEqual(auth.snapshot().quota,quota);auth.dispose();
});
test('unavailable import ledger never resets balance or disables a saved user library',async()=>{
  const fixture=sdkFixture(user('alice'));
  const auth=createStudyAuth({mockSDK:fixture.sdk,fetchImpl:(url,init)=>url.endsWith('/entitlements')?Promise.resolve(new Response('{}',{status:503})):transport()(url,init)});
  await auth.initialize();await assert.rejects(auth.refreshEntitlements());
  assert.equal(auth.snapshot().status,'signed-in');assert.equal(auth.snapshot().entitlements,null);assert.equal(auth.snapshot().importsStatus,'unavailable');assert.deepEqual(auth.snapshot().quota,quota);auth.dispose();
});

test('successful entitlement refresh restores the exact import balance without deducting AI credit',async()=>{
  const fixture=sdkFixture(user('alice')),value={schemaVersion:1,imports:{limit:10,used:3,remaining:7},starterPack:{priceUsd:5,additionalImports:100,studySessions:20,available:false}};
  const auth=createStudyAuth({mockSDK:fixture.sdk,fetchImpl:(url,init)=>url.endsWith('/entitlements')?Promise.resolve(new Response(JSON.stringify(value))):transport()(url,init)});
  await auth.initialize();await auth.refreshEntitlements();assert.deepEqual(auth.snapshot().entitlements,value);assert.equal(auth.snapshot().importsStatus,'ready');assert.deepEqual(auth.snapshot().quota,quota);await auth.signOut();assert.equal(auth.snapshot().entitlements,null);auth.dispose();
});

test('older balance reads cannot overwrite a newer same-account balance',async()=>{
  const fixture=sdkFixture(user('alice')),replies=[];
  const auth=createStudyAuth({mockSDK:fixture.sdk,fetchImpl:(url,init)=>url.endsWith('/entitlements')?new Promise(resolve=>{replies.push(used=>resolve(new Response(JSON.stringify({schemaVersion:1,imports:{limit:10,used,remaining:10-used},starterPack:{available:false}}))));}):transport()(url,init)});
  await auth.initialize();const first=auth.refreshEntitlements();await new Promise(resolve=>setImmediate(resolve));const second=auth.refreshEntitlements();await new Promise(resolve=>setImmediate(resolve));
  replies[1](10);await second;replies[0](0);await first;assert.equal(auth.snapshot().entitlements.imports.remaining,0);auth.dispose();
});
