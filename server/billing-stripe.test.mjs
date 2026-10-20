import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {createStripeProvider,checkoutParameters,stripeConfig,stripeSandboxConfig,validateCanonicalPayment} from './billing/stripe.mjs';
const config={merchantId:'acct_fixture',apiKey:'rk_test_fixture',webhookSecret:'whsec_fixture',origin:'https://delta.example',livemode:false},id='00000000-0000-4000-8000-000000000001';
const orderFor=(target=config,schemaVersion=1)=>({schemaVersion,id,userKey:'a'.repeat(64),createdAt:1000000,merchantId:target.merchantId,livemode:target.livemode});
const envFor=(mode='sandbox',prefix='DELTA_STRIPE')=>({[`${prefix}_ENABLED`]:mode,[`${prefix}_ACCOUNT_ID`]:'acct_fixture',[`${prefix}_RESTRICTED_KEY`]:`rk_${mode==='live'?'live':'test'}_fixture`,[`${prefix}_WEBHOOK_SECRET`]:'whsec_fixture',[`${prefix}_TEST_UIDS`]:'alice',STUDY_ORIGIN:config.origin});
function providerFixture(target=config){
  const calls=[],account={id:target.merchantId,charges_enabled:true,payouts_enabled:true},balance={livemode:target.livemode};
  const provider=createStripeProvider(target,{client:{accounts:{retrieve:async()=>{calls.push({step:'account'});return {...account};}},balance:{retrieve:async()=>({...balance})},
    checkout:{sessions:{create:async(params,options)=>{calls.push({step:'checkout',params,options});return {id:target.livemode?'cs_live_fixture':'cs_test_fixture',url:'https://checkout.stripe.com/c/pay/fixture',expires_at:2000};}}},
    paymentIntents:{capture:async(pi,params,options)=>calls.push({step:'capture',pi,params,options}),cancel:async(pi,params,options)=>calls.push({step:'cancel',pi,params,options})}}});
  return {provider,calls,account,balance};
}
test('webhook verification uses the exact raw bytes, checks freshness, and rejects tampering before business use',()=>{
  const sdk=new Stripe('rk_test_fixture'),provider=createStripeProvider(config,{client:sdk}),payload=JSON.stringify({id:'evt_fixture',livemode:false,type:'checkout.session.completed',data:{object:{}}});
  const signature=timestamp=>sdk.webhooks.generateTestHeaderString({payload,secret:config.webhookSecret,...(timestamp?{timestamp}:{})});
  assert.equal(provider.event(Buffer.from(payload),signature()).id,'evt_fixture');
  assert.throws(()=>provider.event(Buffer.from(payload+' '),signature()),{code:'invalid_payment_signature'});
  assert.throws(()=>provider.event(Buffer.from(payload),signature(Math.floor(Date.now()/1000)-400)),{code:'invalid_payment_signature'});
  assert.throws(()=>provider.event(payload,signature()),{code:'invalid_payment_signature'});
  assert.throws(()=>provider.event(Buffer.alloc(262145),signature()),{code:'invalid_payment_signature'});
});
test('Checkout parameters are fixed USD 5, card-only, manual capture, server-owned metadata and stable idempotency',async()=>{
  const order=orderFor(),params=checkoutParameters(order,config),calls=[];
  assert.equal(params.payment_intent_data.capture_method,'manual');assert.equal(params.line_items[0].price_data.unit_amount,500);assert.equal(params.line_items[0].quantity,1);assert.equal(params.line_items[0].price_data.currency,'usd');
  assert.deepEqual(params.allowed_payment_method_types,['card']);assert.equal(Object.hasOwn(params,'payment_method_types'),false);assert.equal(params.adaptive_pricing.enabled,false);assert.equal(params.automatic_tax.enabled,false);
  const provider=createStripeProvider(config,{client:{accounts:{retrieve:async()=>({id:config.merchantId})},balance:{retrieve:async()=>({livemode:false})},checkout:{sessions:{create:async(p,options)=>{calls.push({p,options});return {id:'cs_test_fixture',url:'https://checkout.stripe.com/c/pay/cs_test_fixture',expires_at:2000};}}}}});
  await provider.createCheckout(order);await provider.createCheckout(order);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].options.idempotencyKey,`delta-checkout-${id}`);
});
test('foreign merchant fails closed before checkout even with a matching order target',async()=>{
  let checkout=0;const provider=createStripeProvider(config,{client:{accounts:{retrieve:async()=>({id:'acct_foreign'})},balance:{retrieve:async()=>({livemode:false})},checkout:{sessions:{create:()=>{checkout++;}}}}});
  await assert.rejects(provider.createCheckout(orderFor()),{code:'billing_merchant_mismatch'});assert.equal(checkout,0);
});

test('provider failures retain safe correlation and type without exposing keys, headers or SDK bodies',async()=>{
  const diagnostics=[];
  const error=Object.assign(Error('rk_test_DO_NOT_DISCLOSE raw-body'),{type:'StripeAuthenticationError',code:'account_invalid',statusCode:401,requestId:'req_fixture',headers:{authorization:'DO_NOT_DISCLOSE'},raw:{body:'DO_NOT_DISCLOSE'}});
  const provider=createStripeProvider(config,{client:{accounts:{retrieve:async()=>{throw error;}},balance:{retrieve:async()=>({livemode:false})}},onDiagnostic:event=>diagnostics.push(event)});
  await assert.rejects(provider.createCheckout(orderFor()),e=>e.code==='payment_provider_unavailable'&&!e.message.includes('DO_NOT_DISCLOSE'));
  assert.deepEqual(diagnostics,[{event:'delta_payment_provider_failure',step:'readiness',type:'StripeAuthenticationError',code:'account_invalid',httpStatus:401,requestId:'req_fixture'}]);
});


test('sales pause keeps valid provider configuration instead of disabling in-flight fulfillment',()=>{
  const env={DELTA_STRIPE_ENABLED:'sandbox',DELTA_STRIPE_TEST_UIDS:'alice',DELTA_STRIPE_ACCOUNT_ID:'acct_1SRumIK2shGNs8tz',DELTA_STRIPE_RESTRICTED_KEY:'rk_test_fixture',DELTA_STRIPE_WEBHOOK_SECRET:'whsec_fixture',STUDY_ORIGIN:config.origin};
  assert.equal(stripeSandboxConfig(env).salesPaused,false);
  assert.equal(stripeSandboxConfig({...env,DELTA_STRIPE_SALES_PAUSED:'true'}).salesPaused,true);
});

test('mode-specific restricted keys and explicit current or legacy merchants are parsed without fallback',()=>{
  assert.equal(stripeConfig({}),null);
  assert.equal(stripeConfig({DELTA_STRIPE_ENABLED:''}),null);
  const sandbox=stripeConfig(envFor());assert.equal(sandbox.livemode,false);assert.deepEqual(sandbox.testUids,['alice']);
  const live=stripeConfig({...envFor('live'),DELTA_STRIPE_TEST_UIDS:undefined});assert.equal(live.livemode,true);assert.deepEqual(live.testUids,[]);
  assert.deepEqual(stripeConfig(envFor('live')).testUids,[]);
  const legacy=stripeConfig({...envFor('live'),...envFor('sandbox','DELTA_STRIPE_LEGACY'),DELTA_STRIPE_LEGACY_ACCOUNT_ID:'acct_old'},{prefix:'DELTA_STRIPE_LEGACY'});
  assert.equal(legacy.merchantId,'acct_old');assert.equal(legacy.livemode,false);
  assert.equal(stripeSandboxConfig(envFor()).livemode,false);
  assert.throws(()=>stripeSandboxConfig(envFor('live')),{code:'billing_configuration_invalid'});
});

test('malformed or mismatched credentials, mode, origin and test lists fail configuration closed',()=>{
  for(const change of [{DELTA_STRIPE_ENABLED:'production'},{DELTA_STRIPE_ENABLED:false},{DELTA_STRIPE_RESTRICTED_KEY:'rk_live_fixture'},
    {DELTA_STRIPE_RESTRICTED_KEY:'sk_test_fixture'},{DELTA_STRIPE_ACCOUNT_ID:'fixture'},{DELTA_STRIPE_WEBHOOK_SECRET:''},
    {STUDY_ORIGIN:'https://delta.example/path'},{DELTA_STRIPE_TEST_UIDS:''},{DELTA_STRIPE_TEST_UIDS:'a b'},
    {DELTA_STRIPE_TEST_UIDS:Array(21).fill('alice').join(',')}])assert.throws(()=>stripeConfig({...envFor(),...change}),{code:'billing_configuration_invalid'});
  for(const change of [{DELTA_STRIPE_RESTRICTED_KEY:'rk_test_fixture'},{DELTA_STRIPE_TEST_UIDS:7},{DELTA_STRIPE_TEST_UIDS:'a\u0000b'}])assert.throws(()=>stripeConfig({...envFor('live'),...change}),{code:'billing_configuration_invalid'});
});

test('checkout and money mutations reject foreign immutable targets before any Stripe request',async()=>{
  for(const order of [{...orderFor(),merchantId:'acct_other'},{...orderFor(),livemode:true},{...orderFor(),livemode:undefined}]){
    const f=providerFixture();
    assert.throws(()=>checkoutParameters(order,config),{code:'billing_merchant_mismatch'});
    await assert.rejects(f.provider.createCheckout(order),{code:'billing_merchant_mismatch'});
    await assert.rejects(f.provider.capture('pi_fixture',id,order),{code:'billing_merchant_mismatch'});
    await assert.rejects(f.provider.cancel('pi_fixture',id,order),{code:'billing_merchant_mismatch'});
    assert.deepEqual(f.calls,[]);
  }
});

test('live readiness requires exact balance mode and both charging and payout readiness before checkout or capture',async()=>{
  const live={...config,livemode:true,apiKey:'rk_live_fixture'},order=orderFor(live,2);
  for(const change of [{charges_enabled:false},{payouts_enabled:false},{charges_enabled:undefined},{payouts_enabled:undefined}]){
    const f=providerFixture(live);Object.assign(f.account,change);
    await assert.rejects(f.provider.createCheckout(order),{code:'billing_merchant_not_ready'});
    await assert.rejects(f.provider.capture('pi_fixture',id,order),{code:'billing_merchant_not_ready'});
    assert.equal(f.calls.some(c=>['checkout','capture'].includes(c.step)),false);
  }
  for(const target of [config,live]){
    const f=providerFixture(target);f.balance.livemode=!target.livemode;
    await assert.rejects(f.provider.createCheckout(orderFor(target,2)),{code:'billing_merchant_mismatch'});
    assert.equal(f.calls.some(c=>c.step==='checkout'),false);
  }
  const f=providerFixture(live);await f.provider.createCheckout(order);f.account.charges_enabled=false;
  await assert.rejects(f.provider.capture('pi_fixture',id,order),{code:'billing_merchant_not_ready'});
  await f.provider.cancel('pi_fixture',id,order);assert.equal(f.calls.at(-1).step,'cancel');
});

test('schema-v1 Stripe idempotency keys remain unchanged and v2 keys bind mode and merchant',async()=>{
  const legacy=providerFixture();await legacy.provider.createCheckout(orderFor());await legacy.provider.capture('pi_fixture',id);await legacy.provider.cancel('pi_fixture',id);
  for(const call of legacy.calls.filter(c=>c.options))assert.equal(call.options.idempotencyKey,`delta-${call.step}-${id}`);
  const seen=new Set();
  for(const target of [config,{...config,merchantId:'acct_other'},{...config,livemode:true,apiKey:'rk_live_fixture'}]){
    const f=providerFixture(target),order=orderFor(target,2);
    await f.provider.createCheckout(order);await f.provider.createCheckout(order);await f.provider.capture('pi_fixture',id,order);await f.provider.cancel('pi_fixture',id,order);
    const calls=f.calls.filter(c=>c.options);assert.equal(calls[0].options.idempotencyKey,calls[1].options.idempotencyKey);
    for(const call of calls){assert.match(call.options.idempotencyKey,new RegExp(`^delta-${call.step}-${target.merchantId}-${target.livemode?'live':'sandbox'}-${id}$`));assert.ok(call.options.idempotencyKey.length<=255);}
    seen.add(calls[0].options.idempotencyKey);
  }
  assert.equal(seen.size,3);
  const live=providerFixture({...config,livemode:true,apiKey:'rk_live_fixture'});
  await assert.rejects(live.provider.capture('pi_fixture',id),{code:'billing_merchant_mismatch'});
  assert.deepEqual(live.calls,[]);
});

test('canonical checkout and intent mode must exactly match the immutable order',()=>{
  for(const livemode of [false,true]){
    const order={...orderFor({...config,livemode},2),checkoutId:livemode?'cs_live_fixture':'cs_test_fixture',paymentIntentId:'pi_fixture'};
    const value={id:order.checkoutId,livemode,orderId:id,pack:'delta-starter-v1',userKey:order.userKey,currency:'usd',amount:500,items:[{quantity:1,amount:500,currency:'usd',pack:'delta-starter-v1'}],intent:{id:'pi_fixture',livemode,currency:'usd',amount:500,captureMethod:'manual',orderId:id}};
    assert.equal(validateCanonicalPayment(value,order).id,'pi_fixture');
    for(const mutated of [{...value,livemode:!livemode},{...value,livemode:undefined},{...value,intent:{...value.intent,livemode:!livemode}},
      {...value,intent:{...value.intent,livemode:undefined}},{...value,amount:499},{...value,userKey:'b'.repeat(64)},{...value,intent:{...value.intent,id:'pi_other'}}])assert.throws(()=>validateCanonicalPayment(mutated,order),{code:'payment_mismatch'});
  }
});
