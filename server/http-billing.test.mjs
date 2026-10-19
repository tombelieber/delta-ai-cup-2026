import test from 'node:test';import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {createServer} from './index.mjs';
import {createStripeProvider} from './billing/stripe.mjs';
import {StudyError} from './study/source.mjs';
const id='00000000-0000-4000-8000-000000000001';
async function fixture(t,{enabled=true,mode='google'}={}){
  const calls=[],sdk=new Stripe('rk_test_fixture'),provider=createStripeProvider({apiKey:'rk_test_fixture',webhookSecret:'whsec_fixture'},{client:sdk});
  const accounts={config:()=>({enabled:false}),forUser:()=>({snapshot:async()=>({limitUsd:.5,remainingUsd:0,spentUsd:.5,reservedUsd:0})}),authenticate:async req=>{if(!req.headers.authorization)throw new StudyError('authentication_required',401);return {uid:req.headers.authorization.slice(7)};},paidUsage:{snapshot:async()=>({sessions:{limit:20,used:0,reserved:0,remaining:20},classificationAvailable:true})}};
  const billing={checkout:async(uid,body)=>{calls.push({uid,body});return {id,status:'created',granted:false,mode:'sandbox',priceUsd:5};},reconcile:async(order,uid)=>{if(uid!=='alice')throw new StudyError('purchase_access_denied',403);return {id:order,status:'granted',granted:true,mode:'sandbox',priceUsd:5};},webhook:async(raw,signature)=>{const event=provider.event(raw,signature);calls.push({raw:Buffer.isBuffer(raw),eventId:event.id});return {received:true};}};
  const server=createServer({studyService:{access:{mode,check:()=>null},inspect:async()=>({saved:true})},studyAccounts:accounts,studyBilling:enabled?billing:null,studyEntitlements:{forUser:()=>({snapshot:async()=>({schemaVersion:1,imports:{limit:110,used:0,remaining:110},starterPack:{available:false}})})},requestsPerMinute:200,onDiagnostic:()=>{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(action,body,token='alice')=>{const response=await fetch(`${base}/api/study/${action}`,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
  return {base,request,sdk,calls};
}
test('real HTTP checkout and purchase reconciliation require verified identity, even when local learning is enabled',async t=>{
  for(const mode of ['google','local']){const f=await fixture(t,{mode});assert.equal((await f.request('checkout',{requestId:id},null)).status,401);assert.equal(f.calls.length,0);assert.equal((await f.request('checkout',{requestId:id})).status,200);assert.equal(f.calls[0].uid,'alice');assert.equal((await f.request('reconcilePurchase',{orderId:id},'bob')).status,403);assert.equal((await f.request('reconcilePurchase',{orderId:id})).body.status,'granted');}
});
test('signed webhook bypasses browser-origin checks only for its own path and receives unmodified bytes; invalid, oversized and missing signatures fail',async t=>{
  const f=await fixture(t),payload=JSON.stringify({id:'evt_fixture',livemode:false,type:'test.event',data:{object:{}}}),signature=f.sdk.webhooks.generateTestHeaderString({payload,secret:'whsec_fixture'});
  const send=async(body,sign=signature)=>fetch(`${f.base}/api/billing/stripe-webhook`,{method:'POST',headers:{'content-type':'application/json',origin:'https://stripe.example',...(sign?{'stripe-signature':sign}:{})},body});
  assert.equal((await send(payload)).status,200);assert.equal(f.calls[0].raw,true);assert.equal((await send(payload+' ')).status,400);assert.equal((await send(payload,null)).status,400);assert.equal((await send('x'.repeat(262145))).status,413);assert.equal(f.calls.length,1);
  const browser=await fetch(`${f.base}/api/study/checkout`,{method:'POST',headers:{'content-type':'application/json',origin:'https://stripe.example',authorization:'Bearer alice'},body:JSON.stringify({requestId:id})});assert.equal(browser.status,403);
});
test('missing payment config disables new sales while saved content, account credit and purchased allowance remain available',async t=>{
  const f=await fixture(t,{enabled:false});assert.equal((await f.request('checkout',{requestId:id})).status,503);assert.equal((await f.request('inspect',{})).body.saved,true);assert.equal((await f.request('session')).body.quota.limitUsd,.5);const e=await f.request('entitlements');assert.equal(e.body.starterPack.available,false);assert.equal(e.body.paid.sessions.remaining,20);
});
