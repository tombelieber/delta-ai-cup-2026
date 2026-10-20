const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function purchaseFromSearch(search=''){
  const value=new URLSearchParams(search).get('purchase');
  return ID.test(value||'')?value:'';
}
export function purchaseResult(value){
  if(!ID.test(value?.id||'')||!['sandbox','live'].includes(value.mode)||value.priceUsd!==5||typeof value.granted!=='boolean'
    ||!['created','capacity_reserved','granted','canceled','refunded','reconciliation_required'].includes(value.status)
    ||value.status==='granted'&&!value.granted||value.granted&&!['granted','refunded','reconciliation_required'].includes(value.status))throw Error('The purchase response could not be verified. Check your existing purchase before trying again.');
  return value;
}
export function stripeCheckoutUrl(value){
  let url;try{url=new URL(value);}catch{}
  if(!url||url.origin!=='https://checkout.stripe.com'||url.username||url.password||!url.pathname.startsWith('/c/pay/'))throw Error('The payment link could not be verified. No new payment was opened.');
  return url.href;
}
export function purchaseCheckoutRequest({requestId,existingOrder}={}){
  if(existingOrder){const purchase=purchaseResult(existingOrder);if(purchase.status!=='created')throw Error('Check this purchase before continuing its checkout.');return {orderId:purchase.id};}
  if(!ID.test(requestId||''))throw Error('The checkout request could not be verified.');
  return {requestId};
}
export function purchaseCheckoutResult(value,{offeredMode,existingOrder}={}){
  const purchase=purchaseResult(value);
  if(existingOrder){
    const expected=purchaseResult(existingOrder);
    if(purchase.id!==expected.id||purchase.mode!==expected.mode)throw Error('The existing checkout could not be verified. Your original purchase was kept. Check this purchase before trying again.');
  }else if(!['sandbox','live'].includes(offeredMode)||purchase.mode!==offeredMode)return {purchase,modeMismatch:true,href:''};
  return {purchase,modeMismatch:false,href:purchase.status==='created'&&purchase.checkoutUrl?stripeCheckoutUrl(purchase.checkoutUrl):''};
}
