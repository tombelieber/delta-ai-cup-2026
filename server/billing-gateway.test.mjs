import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {createPurchaseLedger} from './billing/ledger.mjs';
import {createStarterPackService} from './billing/service.mjs';
import {createBillingGateway} from './billing/gateway.mjs';
import {createStripeProvider} from './billing/stripe.mjs';
import {createPaidUsage} from './billing/usage.mjs';
import {attachStudyBilling} from './billing/composition.mjs';
import {memoryStore,firestoreStore} from './billing-test-support.mjs';
import {PROJECT_BUDGET_ENFORCED} from './study/project-budget.mjs';
import {orderPath} from './billing/policy.mjs';

const key=Buffer.alloc(32,7),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture({verification=false}={}){
  const store=memoryStore();let n=0;
  function entry(merchantId,livemode){
    const ledger=createPurchaseLedger({store,key,merchantId,livemode,newId:()=>id(++n)});
    const sdk=new Stripe('rk_test_fixture'),secret=`whsec_${merchantId.replaceAll('_','')}${livemode?'live':'sandbox'}`;
    const verify=createStripeProvider({webhookSecret:secret},{client:sdk});let payment,captures=0;
    const provider={event:verify.event,
      async createCheckout(order){const checkoutId=`cs_${livemode?'live':'test'}_${order.id.replaceAll('-','')}`;
        payment={id:checkoutId,status:'open',livemode,amount:500,currency:'usd',userKey:order.userKey,orderId:order.id,pack:'delta-starter-v1',items:[{quantity:1,amount:500,currency:'usd',pack:'delta-starter-v1'}],intent:null};
        return {id:checkoutId,url:`https://checkout.stripe.com/c/pay/${checkoutId}`,expiresAt:2000};},
      read:async checkoutId=>{assert.equal(checkoutId,payment.id);return structuredClone(payment);},
      async capture(_pi,orderId,order){assert.equal(order.merchantId,merchantId);assert.equal(order.livemode,livemode);assert.equal(order.id,orderId);assert.equal((await ledger.order(orderId)).capacityReserved,true);captures++;payment.intent.status='succeeded';payment.intent.received=500;payment.intent.capturable=0;},
      cancel:async()=>{payment.intent.status='canceled';},
    };
    return {ledger,provider,service:createStarterPackService({ledger,provider,testUids:['alice']}),
      get captures(){return captures;},get payment(){return payment;},
      authorize(){payment.status='complete';payment.intent={id:'pi_shared',status:'requires_capture',livemode,amount:500,received:0,capturable:500,currency:'usd',captureMethod:'manual',orderId:payment.orderId,refunded:0,disputed:false,card:true};},
      signed(orderId,{mode=livemode,type='checkout.session.completed',metadata=true}={}){const raw=Buffer.from(JSON.stringify({id:'evt_fixture',livemode:mode,type,data:{object:metadata?{metadata:{delta_order_id:orderId}}:{payment_intent:'pi_shared'}}}));return [raw,sdk.webhooks.generateTestHeaderString({payload:raw.toString(),secret})];},
    };
  }
  const legacy=entry('acct_1SRumIK2shGNs8tz',false),current=entry('acct_delta',true);
  const retainedVerification=verification?entry('acct_delta',false):null;
  return {store,legacy,current,verification:retainedVerification,gateway:createBillingGateway({store,key,current,legacy:[legacy,...(retainedVerification?[retainedVerification]:[])]})};
}

test('new live checkouts are public to authenticated users while retained Sandbox remains allowlisted',async()=>{
  const f=fixture();assert.equal(f.gateway.mode,'live');assert.equal(f.gateway.canPurchase('bob'),true);
  const live=await f.gateway.checkout('bob',{requestId:id(91)});assert.equal(live.mode,'live');
  await assert.rejects(f.legacy.service.checkout('bob',{requestId:id(92)}),{code:'billing_test_account_required'});
  assert.equal(f.legacy.captures,0);
});

test('gateway fulfills old pending v1 purchase with its original provider, then live exactly once',async()=>{
  const f=fixture(),old=await f.legacy.service.checkout('alice',{requestId:id(91)});
  f.store.records.get(orderPath(old.id)).schemaVersion=1;f.legacy.authorize();
  const live=await f.gateway.checkout('alice',{requestId:id(92)});f.current.authorize();
  await f.gateway.webhook(...f.legacy.signed(old.id));await f.gateway.webhook(...f.current.signed(live.id));
  await f.gateway.webhook(...f.legacy.signed(old.id,{metadata:false,type:'charge.refunded'}));
  assert.equal((await f.gateway.reconcile(old.id,'alice')).mode,'sandbox');
  assert.equal((await f.gateway.reconcile(live.id,'alice')).mode,'live');
  assert.equal(f.legacy.captures,1);assert.equal(f.current.captures,1);
  assert.equal((await createPaidUsage({store:f.store,key}).snapshot('alice')).sessions.remaining,40);
  await assert.rejects(f.gateway.reconcile(old.id,'bob'),{code:'purchase_access_denied'});
});

test('signed current webhook cannot act on a legacy target or a wrong mode, and unknown signatures fail closed',async()=>{
  const f=fixture(),old=await f.legacy.service.checkout('alice',{requestId:id(91)});f.legacy.authorize();
  await assert.rejects(f.gateway.webhook(...f.current.signed(old.id)),{code:'billing_ledger_invalid'});
  await assert.rejects(f.gateway.webhook(...f.legacy.signed(old.id,{mode:true})),{code:'payment_mismatch'});
  await assert.rejects(f.gateway.webhook(Buffer.from('{}'),'invalid'),{code:'invalid_payment_signature'});
  assert.equal(f.current.captures,0);assert.equal(f.legacy.captures,0);
});

test('legacy request replay stays Sandbox without calling current checkout provider',async()=>{
  const f=fixture(),old=await f.legacy.service.checkout('alice',{requestId:id(91)});
  const replay=await f.gateway.checkout('alice',{requestId:id(91)});
  assert.equal(replay.id,old.id);assert.equal(replay.mode,'sandbox');assert.equal(f.current.payment,undefined);
});

test('interrupted v1 checkout creation resumes against its original provider and stays allowlisted',async()=>{
  const f=fixture(),old=await f.legacy.ledger.open('alice',id(91));f.store.records.get(orderPath(old.id)).schemaVersion=1;
  const replay=await f.gateway.checkout('alice',{requestId:id(91)});
  assert.equal(replay.id,old.id);assert.equal(replay.mode,'sandbox');assert.match(replay.checkoutUrl,/cs_test_/);
  assert.equal(f.current.payment,undefined);
  const resumed=await f.gateway.checkout('alice',{orderId:old.id});assert.equal(resumed.id,old.id);assert.equal(resumed.mode,'sandbox');
  await assert.rejects(f.gateway.checkout('bob',{orderId:old.id}),{code:'purchase_access_denied'});
  const unapproved=await f.legacy.ledger.open('bob',id(92));
  await assert.rejects(f.gateway.checkout('bob',{requestId:id(92)}),{code:'billing_test_account_required'});
  assert.equal((await f.legacy.ledger.order(unapproved.id)).checkoutId,null);
});

test('disabled or invalid current config preserves granted usage and explicit legacy reconciliation',async()=>{
  const f=fixture(),old=await f.legacy.service.checkout('alice',{requestId:id(91)});f.legacy.authorize();await f.gateway.reconcile(old.id,'alice');
  const disabled=createBillingGateway({store:f.store,key,legacy:[f.legacy]});assert.equal(disabled.canPurchase('alice'),false);
  await assert.rejects(disabled.checkout('alice',{requestId:id(92)}),{code:'payments_unavailable'});
  assert.equal((await disabled.reconcile(old.id,'alice')).granted,true);
  const {firestore}=firestoreStore(f.store.records),accounts={[PROJECT_BUDGET_ENFORCED]:true};
  attachStudyBilling(accounts,{firestore,key,env:{DELTA_STRIPE_ENABLED:'live'}});
  assert.equal(accounts.billing,null);assert.equal((await accounts.paidUsage.snapshot('alice')).sessions.remaining,20);
  const missing=createBillingGateway({store:f.store,key,current:f.current});
  await assert.rejects(missing.reconcile(old.id,'alice'),{code:'purchase_provider_unavailable'});
});

test('three immutable targets retain separately signed fulfillment and owned receipt replay without another storefront',async()=>{
  const f=fixture({verification:true});
  const old=await f.legacy.service.checkout('alice',{requestId:id(91)});f.store.records.get(orderPath(old.id)).schemaVersion=1;
  const verification=await f.verification.service.checkout('alice',{requestId:id(92)});
  const live=await f.gateway.checkout('alice',{requestId:id(93)});
  for(const [entry,order] of [[f.legacy,old],[f.verification,verification],[f.current,live]]){
    entry.authorize();await f.gateway.webhook(...entry.signed(order.id));await f.gateway.webhook(...entry.signed(order.id));
    const replay=await f.gateway.checkout('alice',{requestId:id(order===old?91:order===verification?92:93)});
    assert.equal(replay.id,order.id);assert.equal(replay.mode,order.mode);
    const receipt=await f.gateway.checkout('alice',{orderId:order.id});assert.equal(receipt.granted,true);
    await assert.rejects(f.gateway.checkout('bob',{orderId:order.id}),{code:'purchase_access_denied'});
    assert.equal(entry.captures,1);
  }
  assert.equal((await createPaidUsage({store:f.store,key}).snapshot('alice')).sessions.remaining,60);
  assert.equal(f.gateway.mode,'live');assert.equal(f.gateway.canPurchase('bob'),true);
  await assert.rejects(f.verification.service.checkout('bob',{requestId:id(94)}),{code:'billing_test_account_required'});
  assert.equal([...f.store.records.keys()].filter(k=>k.startsWith('studyPurchases/')).length,3);
});

test('two retained Sandboxes have distinct signing secrets and cannot fulfill each other or live orders',async()=>{
  const f=fixture({verification:true}),entries=[f.legacy,f.verification,f.current],orders=[];
  for(let i=0;i<entries.length;i++){orders.push(await entries[i].service.checkout('alice',{requestId:id(91+i)}));entries[i].authorize();}
  for(let i=0;i<entries.length;i++)for(let j=0;j<entries.length;j++)if(i!==j){
    await assert.rejects(f.gateway.webhook(...entries[i].signed(orders[j].id)),{code:'billing_ledger_invalid'});
  }
  await assert.rejects(f.gateway.webhook(...f.verification.signed(orders[1].id,{mode:true})),{code:'payment_mismatch'});
  await assert.rejects(f.gateway.webhook(Buffer.from('{}'),'invalid'),{code:'invalid_payment_signature'});
  for(let i=0;i<entries.length;i++){
    assert.equal(entries[i].captures,0);await f.gateway.webhook(...entries[i].signed(orders[i].id));assert.equal(entries[i].captures,1);
  }
});

function compositionEnv(){
  const env={STUDY_ORIGIN:'https://delta.example'};
  for(const [prefix,merchant,mode] of [['DELTA_STRIPE','acct_delta','live'],['DELTA_STRIPE_LEGACY','acct_1SRumIK2shGNs8tz','sandbox'],['DELTA_STRIPE_VERIFICATION','acct_delta','sandbox']]){
    Object.assign(env,{[`${prefix}_ENABLED`]:mode,[`${prefix}_ACCOUNT_ID`]:merchant,[`${prefix}_RESTRICTED_KEY`]:`rk_${mode==='live'?'live':'test'}_fixture`,[`${prefix}_WEBHOOK_SECRET`]:`whsec_${prefix.replaceAll('_','')}`,[`${prefix}_TEST_UIDS`]:'alice'});
  }
  return env;
}
async function composedFixture(change={}){
  const f=fixture({verification:true});
  const old=await f.legacy.service.checkout('alice',{requestId:id(91)}),verification=await f.verification.service.checkout('alice',{requestId:id(92)});
  const {firestore}=firestoreStore(f.store.records),accounts={[PROJECT_BUDGET_ENFORCED]:true};
  attachStudyBilling(accounts,{firestore,key,env:{...compositionEnv(),...change}});
  return {f,old,verification,accounts};
}

test('actual composition retains both Sandbox targets when live sales are enabled, paused or absent',async()=>{
  for(const change of [{},{DELTA_STRIPE_SALES_PAUSED:'true'},{DELTA_STRIPE_ENABLED:undefined},
    {DELTA_STRIPE_ENABLED:'sandbox',DELTA_STRIPE_RESTRICTED_KEY:'rk_test_fixture',DELTA_STRIPE_ACCOUNT_ID:'acct_other'}]){
    const {f,accounts,old,verification}=await composedFixture(change);assert.ok(accounts.billing);
    assert.equal(accounts.billing.canPurchase('bob'),!Object.keys(change).length);
    for(const order of [old,verification]){
      const resumed=await accounts.billing.checkout('alice',{orderId:order.id});assert.equal(resumed.id,order.id);assert.equal(resumed.mode,'sandbox');assert.equal(resumed.checkoutUrl,order.checkoutUrl);
      await assert.rejects(accounts.billing.checkout('bob',{orderId:order.id}),{code:'purchase_access_denied'});
    }
    const unapproved=await f.verification.ledger.open('bob',id(94));
    await assert.rejects(accounts.billing.checkout('bob',{orderId:unapproved.id}),{code:'billing_test_account_required'});
    // An explicit receipt resume only reads an already attached checkout. A real
    // Stripe SDK is composed here, but no Stripe API request is dispatched.
  }
});

test('a live verification config is ignored without disabling current sales or original legacy receipts',async()=>{
  const {accounts,old,verification}=await composedFixture({DELTA_STRIPE_VERIFICATION_ENABLED:'live',DELTA_STRIPE_VERIFICATION_RESTRICTED_KEY:'rk_live_fixture'});
  assert.ok(accounts.billing);assert.equal(accounts.billing.mode,'live');assert.equal(accounts.billing.canPurchase('bob'),true);
  assert.equal((await accounts.billing.checkout('alice',{orderId:old.id})).id,old.id);
  await assert.rejects(accounts.billing.checkout('alice',{orderId:verification.id}),{code:'purchase_provider_unavailable'});
  assert.ok(accounts.paidUsage);
});
