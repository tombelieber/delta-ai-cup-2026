import {requireStudy} from '../study/source.mjs';
import {validId} from './policy.mjs';
import {validateCanonicalPayment} from './stripe.mjs';
const EVENTS=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired','payment_intent.amount_capturable_updated','payment_intent.succeeded','payment_intent.canceled','payment_intent.payment_failed','charge.refunded','charge.dispute.created','charge.dispute.funds_withdrawn']);

export function createStarterPackService({ledger,provider,testUids=[],salesPaused=false}){
  const testers=new Set(testUids.map(uid=>ledger.keys.user(uid))),eligible=userKey=>ledger.livemode===true||testers.has(userKey);
  const canPurchase=uid=>!salesPaused&&eligible(ledger.keys.user(uid));
  const locks=new Map();
  const serial=async(id,run)=>{const next=(locks.get(id)||Promise.resolve()).catch(()=>{}).then(run);locks.set(id,next);try{return await next;}finally{if(locks.get(id)===next)locks.delete(id);}};
  async function resumeCheckout(id,uid){return serial(id,async()=>{
    requireStudy(eligible(ledger.keys.user(uid)),'billing_test_account_required',403,'Sandbox checkout is available only to approved test accounts.');
    requireStudy(!salesPaused,'billing_sales_paused',503,'New purchases are paused. Existing purchases and paid sessions remain available.');
    const order=await ledger.order(id,uid);if(order.checkoutId||order.status!=='created')return ledger.publicOrder(order);
    const checkout=await provider.createCheckout(order);return ledger.attach(order.id,checkout);
  });}
  async function reconcile(id,uid){return serial(id,async()=>{
    const order=await ledger.order(id,uid);if(!order.checkoutId)return ledger.publicOrder(order);
    const payment=await provider.read(order.checkoutId),pi=validateCanonicalPayment(payment,order);
    if(pi?.refunded>0||pi?.disputed){
      // Any confirmed refund/dispute suspends unused delivery; partial refunds
      // are never interpreted as a new full-price payment.
      return ledger.revoke(id,{refunded:true});
    }
    if(payment.status==='expired'&&!pi||pi?.status==='canceled')return ledger.revoke(id);
    if(!pi)return ledger.publicOrder(order);
    if(pi.status==='requires_capture'){
      requireStudy(eligible(order.userKey),'billing_test_account_required',403,'Sandbox checkout is available only to approved test accounts.');
      requireStudy(pi.capturable===500&&pi.received===0&&pi.card===true,'payment_mismatch',409);
      try{await ledger.reserveCapacity(id,pi.id);}
      catch(error){if(error.code!=='pack_capacity_unavailable')throw error;
        try{await provider.cancel(pi.id,id,order);const canceled=await provider.read(order.checkoutId);validateCanonicalPayment(canceled,order);requireStudy(canceled.intent?.status==='canceled','payment_reconciliation_required',503);return await ledger.revoke(id);}
        catch{await ledger.markUnknown(id);throw error;}
      }
      try{await provider.capture(pi.id,id,order);}catch{await ledger.markUnknown(id);requireStudy(false,'payment_reconciliation_required',503,'Payment confirmation is pending. Check this purchase again; do not start another payment.');}
      const captured=await provider.read(order.checkoutId),confirmed=validateCanonicalPayment(captured,await ledger.order(id));
      requireStudy(confirmed?.status==='succeeded'&&confirmed.received===500&&confirmed.refunded===0&&!confirmed.disputed&&confirmed.card===true,'payment_reconciliation_required',503);
      return ledger.grant(id,pi.id);
    }
    if(pi.status==='succeeded'){
      requireStudy(order.granted||eligible(order.userKey),'billing_test_account_required',403);
      requireStudy(pi.received===500&&pi.refunded===0&&!pi.disputed&&pi.card===true,'payment_mismatch',409);
      // A payment outside our reserve-before-capture path requires operator
      // reconciliation; an unsolicited captured event never allocates capacity.
      requireStudy(order.capacityReserved,'payment_reconciliation_required',503);
      return ledger.grant(id,pi.id);
    }
    return ledger.publicOrder(order);
  });}
  return {
    mode:ledger.livemode?'live':'sandbox',canPurchase,snapshot:uid=>ledger.snapshot(uid),resumeCheckout,
    async checkout(uid,input){requireStudy(eligible(ledger.keys.user(uid)),'billing_test_account_required',403,'Sandbox checkout is available only to approved test accounts.');requireStudy(!salesPaused,'billing_sales_paused',503,'New purchases are paused. Existing purchases and paid sessions remain available.');requireStudy(input&&Object.keys(input).length===1&&validId(input.requestId),'invalid_purchase',400);
      const order=await ledger.open(uid,input.requestId);
      // A legacy request replay is a read of its original order, never a
      // checkout creation against the newly configured merchant.
      if(!ledger.matches(order)||order.checkoutId)return ledger.publicOrder(order);
      return resumeCheckout(order.id,uid);},
    reconcile,
    async webhook(raw,signature){const event=provider.event(raw,signature);
      requireStudy(event?.livemode===Boolean(ledger.livemode)&&!event.account&&typeof event.id==='string'&&/^evt_[A-Za-z0-9]+$/.test(event.id),'payment_mismatch',400);
      if(!EVENTS.has(event.type))return {received:true};
      const value=event.data?.object;let id=value?.metadata?.delta_order_id;
      if(!validId(id)){const pi=typeof value?.payment_intent==='string'?value.payment_intent:value?.id?.startsWith('pi_')?value.id:null;id=await ledger.findOrder(pi);}
      if(!validId(id))return {received:true};
      const order=await ledger.order(id);if(!order.checkoutId)return {received:true};
      // Canonical reads and atomic transitions provide business idempotency,
      // including repeated event IDs and differently ordered event deliveries.
      await reconcile(id);return {received:true};
    },
  };
}
