import test from 'node:test';
import assert from 'node:assert/strict';
import {createPurchaseLedger} from './billing/ledger.mjs';
import {orderPath,orderState} from './billing/policy.mjs';
import {memoryStore} from './billing-test-support.mjs';

const key=Buffer.alloc(32,7),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){const store=memoryStore();let n=0;return {store,
  old:createPurchaseLedger({store,key,merchantId:'acct_1SRumIK2shGNs8tz',newId:()=>id(++n)}),
  live:createPurchaseLedger({store,key,merchantId:'acct_delta',livemode:true,newId:()=>id(++n)})};}
async function attach(ledger,o,suffix){const checkout=`cs_${o.livemode?'live':'test'}_${suffix}`;await ledger.attach(o.id,{id:checkout,url:`https://checkout.stripe.com/c/pay/${checkout}`,expiresAt:2000});}

test('a new merchant opens its own checkout while old pending orders and legacy request replay remain readable',async()=>{
  const f=fixture(),old=await f.old.open('alice',id(91));await attach(f.old,old,'old');
  // A deployed v1 request mapping must keep its original payment target.
  f.store.records.get(orderPath(old.id)).schemaVersion=1;
  f.store.records.set(`studyCheckoutRequests/${f.old.keys.hash('checkout-request',`${old.userKey}\0${id(91)}`)}`,{orderId:old.id});
  const current=await f.live.open('alice',id(92));assert.equal(current.livemode,true);assert.notEqual(current.id,old.id);
  assert.equal((await f.live.open('alice',id(91))).id,old.id);
  assert.equal((await f.old.order(old.id,'alice')).livemode,false);
  await assert.rejects(f.live.order(old.id,'alice'),{code:'billing_ledger_invalid'});
  await assert.rejects(f.old.order(old.id,'bob'),{code:'purchase_access_denied'});
  assert.equal((await f.live.open('alice',id(93))).id,current.id);
});

test('replaying a v2 checkout request across targets never creates a second payment',async()=>{
  const f=fixture(),old=await f.old.open('alice',id(91));await attach(f.old,old,'old');
  const replay=await f.live.open('alice',id(91));assert.equal(replay.id,old.id);assert.equal(replay.livemode,false);
  assert.equal([...f.store.records.keys()].filter(k=>k.startsWith('studyPurchases/')).length,1);
});

test('same PaymentIntent text is isolated by merchant and mode and cannot be rebound within a target',async()=>{
  const f=fixture(),a=await f.old.open('alice',id(91)),b=await f.live.open('alice',id(92));
  await attach(f.old,a,'old');await attach(f.live,b,'live');
  await f.old.reserveCapacity(a.id,'pi_shared');await f.live.reserveCapacity(b.id,'pi_shared');
  assert.equal(await f.old.findOrder('pi_shared'),a.id);assert.equal(await f.live.findOrder('pi_shared'),b.id);
  await f.live.grant(b.id,'pi_shared');const other=await f.live.open('bob',id(93));await attach(f.live,other,'other');
  await assert.rejects(f.live.reserveCapacity(other.id,'pi_shared'),{code:'billing_ledger_invalid'});
});

test('v1 Sandbox records stay valid; mode-mismatched checkout IDs and schema-v1 live records fail closed',async()=>{
  const f=fixture(),old=await f.old.open('alice',id(91));await attach(f.old,old,'old');
  const value=f.store.records.get(orderPath(old.id));value.schemaVersion=1;assert.equal(orderState(value).livemode,false);
  assert.throws(()=>orderState({...value,livemode:true}),{code:'billing_ledger_invalid'});
  const live=await f.live.open('alice',id(92));await assert.rejects(attach(f.live,{...live,livemode:false},'wrong'),{code:'billing_ledger_invalid'});
  await attach(f.live,live,'valid');assert.equal(f.live.publicOrder(await f.live.order(live.id)).mode,'live');
});
