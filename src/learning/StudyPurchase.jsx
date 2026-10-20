import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createStudyClient} from './study-client.mjs';
import {purchaseFromSearch,purchaseResult,stripeCheckoutUrl} from './study-purchase.mjs';

export default function StudyPurchase({auth,state,endpoint=''}){
  const uid=state.user?.uid||'',[busy,setBusy]=useState(false),[error,setError]=useState(''),[purchase,setPurchase]=useState(null);
  const requestId=useRef(''),alive=useRef(true),working=useRef(false);
  const client=useMemo(()=>createStudyClient({endpoint,userId:uid,getToken:()=>auth.getToken(uid)}),[endpoint,uid,auth]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const returned=purchaseFromSearch(globalThis.location?.search),orderId=purchase?.id||returned;
  async function perform(check=false){
    if(working.current)return;working.current=true;setBusy(true);setError('');
    try{
      requestId.current||=crypto.randomUUID();
      const value=purchaseResult(await client.request(check?'reconcilePurchase':'checkout',check?{orderId}:{requestId:requestId.current}));
      if(!alive.current||auth.snapshot().user?.uid!==uid)return;
      setPurchase(value);
      if(['granted','canceled','refunded'].includes(value.status))requestId.current='';
      await auth.refreshEntitlements();
      if(!check&&value.status==='created'&&value.checkoutUrl){await auth.getToken(uid);if(alive.current&&auth.snapshot().user?.uid===uid)globalThis.location.assign(stripeCheckoutUrl(value.checkoutUrl));}
    }catch(value){if(alive.current)setError(value.message||'Purchase confirmation is unavailable. Check this purchase before starting another.');}
    finally{working.current=false;if(alive.current)setBusy(false);}
  }
  const enabled=state.entitlements?.starterPack?.available===true;
  return <details className="study-account-details study-purchase" open={Boolean(orderId)}>
    <summary>Starter Pack · US$5 once</summary>
    <p><strong>100 additional history imports + 20 learning sessions.</strong> Each session covers up to five minutes of captions, four teaching cards, two exercises, up to two follow-up answers and PPTX.</p>
    <p>{enabled?'Sandbox checkout is restricted to approved test accounts and uses test payments. No real money is charged.':'Purchases are currently unavailable. Existing allowance and saved work remain available.'} Your free AI credit is separate.</p>
    {state.entitlements?.paid&&<p role="status">Purchased learning sessions: <strong>{state.entitlements.paid.sessions.remaining} remaining</strong>{state.entitlements.paid.sessions.reserved>0?` · ${state.entitlements.paid.sessions.reserved} in progress`:''}.</p>}
    <p className="study-budget-note">Paid lesson and follow-up recovery copies are encrypted on the server and retained for your account beyond seven days. Your browser library stays on this device. See <a href="/privacy.html" target="_blank" rel="noreferrer">privacy and data controls</a>.</p>
    <p className="study-budget-note">Capacity is checked before capture. Failed generation restores the session unit; provider costs still count. Saved results, practice and exports remain available after allowance runs out.</p>
    {enabled&&<button type="button" disabled={busy} onClick={()=>perform(false)}>{busy?'Checking purchase…':purchase?.status==='created'?'Continue Sandbox checkout':purchase?.status==='granted'?'Buy another Sandbox pack':'Try US$5 Sandbox checkout'}</button>}
    {orderId&&<button type="button" disabled={busy} onClick={()=>perform(true)}>Check this purchase</button>}
    {(purchase||returned)&&<p role="status">{purchase?.status==='granted'?'Payment verified. Your purchased allowance is ready.':purchase?.status==='refunded'?'Refund or dispute confirmed. Unused purchased allowance is suspended.':purchase?.status==='canceled'?'This purchase was canceled. No allowance was added.':'Purchase confirmation pending. Returning from checkout alone does not add allowance.'}</p>}
    {error&&<p role="alert" className="study-account-error">{error}</p>}
  </details>;
}
