import {StudyError} from '../study/source.mjs';
const types=new Set(['StripeConnectionError','StripeAPIError','StripeAuthenticationError','StripePermissionError','StripeRateLimitError','StripeInvalidRequestError','StripeIdempotencyError','StripeCardError']);
const codes=new Set(['api_key_expired','account_invalid','authentication_required','balance_insufficient','charge_already_captured','charge_expired_for_capture','idempotency_key_in_use','parameter_invalid_integer','parameter_missing','parameter_unknown','payment_intent_unexpected_state','rate_limit','resource_missing']);
export async function paymentCall(step,run,onDiagnostic){
  try{return await run();}catch(error){
    if(error instanceof StudyError)throw error;
    const event={event:'delta_payment_provider_failure',step,
      ...(types.has(error?.type)?{type:error.type}:{}),...(codes.has(error?.code)?{code:error.code}:{}),
      ...(Number.isInteger(error?.statusCode)&&error.statusCode>=400&&error.statusCode<=599?{httpStatus:error.statusCode}:{}),
      ...(typeof error?.requestId==='string'&&/^req_[A-Za-z0-9]{1,100}$/.test(error.requestId)?{requestId:error.requestId}:{})};
    try{onDiagnostic(event);}catch{}
    throw new StudyError('payment_provider_unavailable',503,'Payment confirmation is unavailable. Check your existing purchase before starting another payment.');
  }
}
