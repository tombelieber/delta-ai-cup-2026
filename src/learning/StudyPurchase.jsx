import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createStudyClient} from './study-client.mjs';
import {purchaseFromSearch,purchaseResult,purchaseCheckoutRequest,purchaseCheckoutResult} from './study-purchase.mjs';

export function PurchaseStatus({purchase,returned}){
  if(!purchase&&!returned)return null;
  const prefix=purchase?.mode==='sandbox'?'Sandbox test purchase. No real money was charged. ':purchase?.mode==='live'?'US$5 purchase. ':'';
  return <p role="status">{prefix}{purchase?.status==='granted'?purchase.mode==='sandbox'?'Test allowance verified and ready.':'Payment verified. Your purchased allowance is ready.':purchase?.status==='refunded'?'Refund or dispute confirmed. Unused purchased allowance is suspended.':purchase?.status==='canceled'?'This purchase was canceled. No allowance was added.':'Purchase confirmation pending. Returning from checkout alone does not add allowance.'}</p>;
}
export function PurchaseActions({enabled,mode,purchase,busy,perform,orderId}){
  const resume=purchase?.status==='created'&&orderId===purchase.id;
  const changedPendingMode=purchase&&['created','capacity_reserved','reconciliation_required'].includes(purchase.status)&&purchase.mode!==mode;
  return <>
    {changedPendingMode&&<p role="status">This {purchase.mode==='sandbox'?'Sandbox test':'live'} purchase keeps its original checkout mode. {resume?'Continue this existing checkout below, or check its status.':'Check this purchase before starting another.'}</p>}
    {(enabled||resume)&&<button type="button" disabled={busy||Boolean(changedPendingMode&&!resume)} onClick={()=>perform(false,resume)}>{busy?'Checking purchase…':resume?purchase.mode==='sandbox'?'Continue Sandbox test checkout':'Continue US$5 checkout':changedPendingMode?'Check existing purchase first':purchase?.status==='granted'?mode==='sandbox'?'Try another Sandbox test pack':'Buy another US$5 pack':mode==='sandbox'?'Try US$5 Sandbox checkout':'Buy Starter Pack · US$5'}</button>}
    {orderId&&<button type="button" disabled={busy} onClick={()=>perform(true)}>Check this purchase</button>}
  </>;
}

export default function StudyPurchase({auth,state,endpoint=''}){
  const uid=state.user?.uid||'',[busy,setBusy]=useState(false),[error,setError]=useState(''),[purchase,setPurchase]=useState(null);
  const requestId=useRef(''),alive=useRef(true),working=useRef(false);
  const client=useMemo(()=>createStudyClient({endpoint,userId:uid,getToken:()=>auth.getToken(uid)}),[endpoint,uid,auth]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const returned=purchaseFromSearch(globalThis.location?.search),orderId=purchase?.id||returned;
  const mode=state.entitlements?.starterPack?.mode,enabled=state.entitlements?.starterPack?.available===true&&['sandbox','live'].includes(mode);
  async function perform(check=false,resume=false){
    if(working.current)return;working.current=true;setBusy(true);setError('');
    try{
      const existingOrder=resume?purchaseResult(purchase):null;
      if(!check&&!resume)requestId.current||=crypto.randomUUID();
      const raw=await client.request(check?'reconcilePurchase':'checkout',check?{orderId}:purchaseCheckoutRequest({requestId:requestId.current,existingOrder}));
      const checkout=check?{purchase:purchaseResult(raw)}:purchaseCheckoutResult(raw,{offeredMode:mode,existingOrder}),value=checkout.purchase;
      if(!alive.current||auth.snapshot().user?.uid!==uid)return;
      setPurchase(value);
      if(['granted','canceled','refunded'].includes(value.status))requestId.current='';
      await auth.refreshEntitlements();
      if(!check&&checkout.modeMismatch){if(alive.current&&auth.snapshot().user?.uid===uid)setError('This existing purchase uses a different checkout mode and was kept. Continue its original checkout below, or check this purchase.');return;}
      if(!check&&checkout.href){await auth.getToken(uid);if(alive.current&&auth.snapshot().user?.uid===uid)globalThis.location.assign(checkout.href);}
    }catch(value){if(alive.current)setError(value.message||'Purchase confirmation is unavailable. Check this purchase before starting another.');}
    finally{working.current=false;if(alive.current)setBusy(false);}
  }
  return <details className="study-account-details study-purchase" open={Boolean(orderId)}>
    <summary>Starter Pack · {enabled&&mode==='sandbox'?'US$5 Sandbox test':'US$5 one-time'}</summary>
    <p><strong>100 additional history imports + 20 learning sessions.</strong> Each session covers up to five minutes of captions, four teaching cards, two exercises, up to two follow-up answers and PPTX.</p>
    <p>{enabled?mode==='sandbox'?'Sandbox checkout is for approved test accounts only. Use test payments; no real money is charged.':'US$5 one-time payment through Stripe Checkout. No subscription. Allowance is added after payment is verified.':'Purchases are currently unavailable. Existing allowance and saved work remain available.'} Your free AI credit is separate.</p>
    {state.entitlements?.paid&&<p role="status">Purchased learning sessions: <strong>{state.entitlements.paid.sessions.remaining} remaining</strong>{state.entitlements.paid.sessions.reserved>0?` · ${state.entitlements.paid.sessions.reserved} in progress`:''}.</p>}
    <p className="study-budget-note">Paid lesson and follow-up recovery copies are encrypted on the server and retained for your account beyond seven days. Your browser library stays on this device. See <a href="/privacy.html" target="_blank" rel="noreferrer">privacy and data controls</a>.</p>
    <p className="study-budget-note">Capacity is checked before capture. Failed generation restores the session unit; provider costs still count. Saved results, practice and exports remain available after allowance runs out.</p>
    <PurchaseActions enabled={enabled} mode={mode} purchase={purchase} busy={busy} perform={perform} orderId={orderId}/>
    <PurchaseStatus purchase={purchase} returned={returned}/>
    {error&&<p role="alert" className="study-account-error">{error}</p>}
  </details>;
}
