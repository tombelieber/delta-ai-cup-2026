import StripeClient from 'stripe';
import {requireStudy} from '../study/source.mjs';
import {PACK} from './policy.mjs';
import {paymentCall} from './diagnostics.mjs';

export function stripeSandboxConfig(env=process.env){
  if(env.DELTA_STRIPE_ENABLED!=='sandbox')return null;
  const merchantId=env.DELTA_STRIPE_ACCOUNT_ID,apiKey=env.DELTA_STRIPE_RESTRICTED_KEY,webhookSecret=env.DELTA_STRIPE_WEBHOOK_SECRET,origin=env.STUDY_ORIGIN;
  requireStudy(merchantId==='acct_1SRumIK2shGNs8tz'&&/^rk_test_[A-Za-z0-9]+$/.test(apiKey||'')&&/^whsec_[A-Za-z0-9]+$/.test(webhookSecret||''),'billing_configuration_invalid',503);
  const testUids=typeof env.DELTA_STRIPE_TEST_UIDS==='string'?env.DELTA_STRIPE_TEST_UIDS.split(',').map(v=>v.trim()).filter(Boolean):[];
  requireStudy(testUids.length>0&&testUids.length<=20&&testUids.every(v=>v.length<=128&&!/[\u0000-\u0020\u007f]/.test(v)),'billing_configuration_invalid',503);
  let url;try{url=new URL(origin);}catch{}
  requireStudy(url&&url.origin===origin&&(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)),'billing_configuration_invalid',503);
  return {merchantId,apiKey,webhookSecret,origin,testUids:[...new Set(testUids)],livemode:false};
}
export function checkoutParameters(order,config){
  const suffix=order.id.replaceAll('-','').slice(0,8).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
  return {mode:'payment',allowed_payment_method_types:['card'],adaptive_pricing:{enabled:false},allow_promotion_codes:false,
    automatic_tax:{enabled:false},integration_identifier:`delta_starter_${suffix}`,client_reference_id:order.userKey,
    line_items:[{quantity:1,price_data:{currency:PACK.currency,unit_amount:PACK.amount,product_data:{name:'Delta Starter Pack',description:'100 history imports and 20 bounded learning sessions. One-time purchase.',metadata:{delta_pack:PACK.id}}}}],
    metadata:{delta_order_id:order.id,delta_pack:PACK.id},payment_intent_data:{capture_method:'manual',metadata:{delta_order_id:order.id,delta_pack:PACK.id}},
    expires_at:Math.floor(order.createdAt/1000)+3600,success_url:`${config.origin}/learn?study=1&purchase=${order.id}`,cancel_url:`${config.origin}/learn?study=1&purchase=${order.id}&checkout=canceled`};
}
export function createStripeProvider(config,{client=new StripeClient(config.apiKey,{maxNetworkRetries:0,timeout:15000}),onDiagnostic=event=>console.error(JSON.stringify(event))}={}){
  let verified=false;const call=(step,run)=>paymentCall(step,run,onDiagnostic);
  async function ready(){if(verified)return;
    const [account,balance]=await call('readiness',()=>Promise.all([client.accounts.retrieve(),client.balance.retrieve()]));
    requireStudy(account.id===config.merchantId&&balance.livemode===false,'billing_merchant_mismatch',503);verified=true;
  }
  return {
    async createCheckout(order){await ready();const value=await call('checkout_create',()=>client.checkout.sessions.create(checkoutParameters(order,config),{idempotencyKey:`delta-checkout-${order.id}`}));return {id:value.id,url:value.url,expiresAt:value.expires_at*1000};},
    async read(checkoutId){await ready();const s=await call('checkout_read',()=>client.checkout.sessions.retrieve(checkoutId,{expand:['payment_intent.latest_charge','line_items.data.price.product']}));
      const items=s.line_items?.data||[],pi=s.payment_intent;
      return {id:s.id,livemode:s.livemode,status:s.status,paymentStatus:s.payment_status,amount:s.amount_total,currency:s.currency,userKey:s.client_reference_id,orderId:s.metadata?.delta_order_id,pack:s.metadata?.delta_pack,
        items:items.map(i=>({quantity:i.quantity,amount:i.price?.unit_amount,currency:i.price?.currency,pack:i.price?.product?.metadata?.delta_pack})),
        intent:pi&&typeof pi==='object'?{id:pi.id,livemode:pi.livemode,status:pi.status,amount:pi.amount,received:pi.amount_received,capturable:pi.amount_capturable,currency:pi.currency,captureMethod:pi.capture_method,orderId:pi.metadata?.delta_order_id,
          refunded:pi.latest_charge?.amount_refunded||0,disputed:pi.latest_charge?.disputed===true,card:pi.latest_charge?.payment_method_details?.type==='card'}:null};
    },
    async capture(id,orderId){await ready();await call('capture',()=>client.paymentIntents.capture(id,{amount_to_capture:500},{idempotencyKey:`delta-capture-${orderId}`}));},
    async cancel(id,orderId){await ready();await call('cancel',()=>client.paymentIntents.cancel(id,{}, {idempotencyKey:`delta-cancel-${orderId}`}));},
    event(raw,signature){requireStudy(Buffer.isBuffer(raw)&&raw.length<=262144&&typeof signature==='string'&&signature.length<=2048,'invalid_payment_signature',400);
      try{return client.webhooks.constructEvent(raw,signature,config.webhookSecret,300);}catch{requireStudy(false,'invalid_payment_signature',400,'The payment event signature could not be verified.');}},
  };
}
export function validateCanonicalPayment(value,order){
  requireStudy(value?.id===order.checkoutId&&value.livemode===false&&value.orderId===order.id&&value.pack===PACK.id&&value.userKey===order.userKey
    &&value.currency==='usd'&&value.amount===500&&value.items?.length===1&&value.items[0].quantity===1&&value.items[0].amount===500&&value.items[0].currency==='usd'&&value.items[0].pack===PACK.id,'payment_mismatch',409,'Payment details could not be verified. No additional entitlement was granted.');
  const pi=value.intent;
  if(pi)requireStudy(pi.livemode===false&&pi.currency==='usd'&&pi.amount===500&&pi.captureMethod==='manual'&&pi.orderId===order.id&&(!order.paymentIntentId||pi.id===order.paymentIntentId),'payment_mismatch',409);
  return pi;
}
