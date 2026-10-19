const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function purchaseFromSearch(search=''){
  const value=new URLSearchParams(search).get('purchase');
  return ID.test(value||'')?value:'';
}
export function purchaseResult(value){
  if(!ID.test(value?.id||'')||value.mode!=='sandbox'||value.priceUsd!==5||typeof value.granted!=='boolean'
    ||!['created','capacity_reserved','granted','canceled','refunded','reconciliation_required'].includes(value.status)
    ||value.status==='granted'&&!value.granted||value.granted&&!['granted','refunded','reconciliation_required'].includes(value.status))throw Error('The purchase response could not be verified. Check your existing purchase before trying again.');
  return value;
}
export function stripeCheckoutUrl(value){
  let url;try{url=new URL(value);}catch{}
  if(!url||url.origin!=='https://checkout.stripe.com'||url.username||url.password||!url.pathname.startsWith('/c/pay/'))throw Error('The payment link could not be verified. No new payment was opened.');
  return url.href;
}
