import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {createStripeProvider,checkoutParameters,stripeSandboxConfig} from './billing/stripe.mjs';
const config={merchantId:'acct_fixture',apiKey:'rk_test_fixture',webhookSecret:'whsec_fixture',origin:'https://delta.example'},id='00000000-0000-4000-8000-000000000001';
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
  const order={id,userKey:'a'.repeat(64),createdAt:Date.now()},params=checkoutParameters(order,config),calls=[];
  assert.equal(params.payment_intent_data.capture_method,'manual');assert.equal(params.line_items[0].price_data.unit_amount,500);assert.equal(params.line_items[0].quantity,1);assert.equal(params.line_items[0].price_data.currency,'usd');
  assert.deepEqual(params.allowed_payment_method_types,['card']);assert.equal(Object.hasOwn(params,'payment_method_types'),false);assert.equal(params.adaptive_pricing.enabled,false);assert.equal(params.automatic_tax.enabled,false);
  const provider=createStripeProvider(config,{client:{accounts:{retrieve:async()=>({id:config.merchantId})},balance:{retrieve:async()=>({livemode:false})},checkout:{sessions:{create:async(p,options)=>{calls.push({p,options});return {id:'cs_test_fixture',url:'https://checkout.stripe.com/c/pay/cs_test_fixture',expires_at:2000};}}}}});
  await provider.createCheckout(order);await provider.createCheckout(order);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].options.idempotencyKey,`delta-checkout-${id}`);
});
test('foreign merchant and live credentials fail closed before checkout and only the selected Sandbox can be configured',async()=>{
  let checkout=0;const provider=createStripeProvider(config,{client:{accounts:{retrieve:async()=>({id:'acct_foreign'})},balance:{retrieve:async()=>({livemode:false})},checkout:{sessions:{create:()=>{checkout++;}}}}});
  await assert.rejects(provider.createCheckout({}),{code:'billing_merchant_mismatch'});assert.equal(checkout,0);
  assert.equal(stripeSandboxConfig({DELTA_STRIPE_ENABLED:'live'}),null);
  for(const change of [{DELTA_STRIPE_RESTRICTED_KEY:'sk_live_fixture'},{DELTA_STRIPE_ACCOUNT_ID:'acct_foreign'},{DELTA_STRIPE_WEBHOOK_SECRET:''},{STUDY_ORIGIN:'https://delta.example/path'}])assert.throws(()=>stripeSandboxConfig({DELTA_STRIPE_ENABLED:'sandbox',DELTA_STRIPE_TEST_UIDS:'alice',DELTA_STRIPE_ACCOUNT_ID:'acct_1SRumIK2shGNs8tz',DELTA_STRIPE_RESTRICTED_KEY:'rk_test_fixture',DELTA_STRIPE_WEBHOOK_SECRET:'whsec_fixture',STUDY_ORIGIN:config.origin,...change}),{code:'billing_configuration_invalid'});
});

test('provider failures retain safe correlation and type without exposing keys, headers or SDK bodies',async()=>{
  const diagnostics=[];
  const error=Object.assign(Error('rk_test_DO_NOT_DISCLOSE raw-body'),{type:'StripeAuthenticationError',code:'account_invalid',statusCode:401,requestId:'req_fixture',headers:{authorization:'DO_NOT_DISCLOSE'},raw:{body:'DO_NOT_DISCLOSE'}});
  const provider=createStripeProvider(config,{client:{accounts:{retrieve:async()=>{throw error;}},balance:{retrieve:async()=>({livemode:false})}},onDiagnostic:event=>diagnostics.push(event)});
  await assert.rejects(provider.createCheckout({}),e=>e.code==='payment_provider_unavailable'&&!e.message.includes('DO_NOT_DISCLOSE'));
  assert.deepEqual(diagnostics,[{event:'delta_payment_provider_failure',step:'readiness',type:'StripeAuthenticationError',code:'account_invalid',httpStatus:401,requestId:'req_fixture'}]);
});


test('sales pause keeps valid provider configuration instead of disabling in-flight fulfillment',()=>{
  const env={DELTA_STRIPE_ENABLED:'sandbox',DELTA_STRIPE_TEST_UIDS:'alice',DELTA_STRIPE_ACCOUNT_ID:'acct_1SRumIK2shGNs8tz',DELTA_STRIPE_RESTRICTED_KEY:'rk_test_fixture',DELTA_STRIPE_WEBHOOK_SECRET:'whsec_fixture',STUDY_ORIGIN:config.origin};
  assert.equal(stripeSandboxConfig(env).salesPaused,false);
  assert.equal(stripeSandboxConfig({...env,DELTA_STRIPE_SALES_PAUSED:'true'}).salesPaused,true);
});
