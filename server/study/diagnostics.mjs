import {randomUUID} from 'node:crypto';

const enums={
  step:new Set(['lesson_contract','citation_contract','countTokens','generateContent']),
  kind:new Set(['format','source_integrity','safety']),
  phase:new Set(['envelope','finish','content','json','count_tokens']),
  reason:new Set(['expected_string','blank_string','string_too_long','disallowed_control_character','expected_array',
    'array_count_out_of_range','expected_object','unknown_anchor','unknown_source','duplicate_options','expected_integer',
    'integer_out_of_range','unsupported_source','invalid_source','response_too_large','invalid_response_json',
    'invalid_token_count','unfinished_response','missing_output','output_too_large','invalid_output_json']),
  providerStatus:new Set(['OK','CANCELLED','UNKNOWN','INVALID_ARGUMENT','DEADLINE_EXCEEDED','NOT_FOUND','ALREADY_EXISTS',
    'PERMISSION_DENIED','UNAUTHENTICATED','RESOURCE_EXHAUSTED','FAILED_PRECONDITION','ABORTED','OUT_OF_RANGE',
    'UNIMPLEMENTED','INTERNAL','UNAVAILABLE','DATA_LOSS']),
  finishReason:new Set(['STOP','MAX_TOKENS','SAFETY','RECITATION','LANGUAGE','OTHER','BLOCKLIST','PROHIBITED_CONTENT','SPII',
    'MALFORMED_FUNCTION_CALL','IMAGE_SAFETY','UNEXPECTED_TOOL_CALL','TOO_MANY_TOOL_CALLS','MISSING_THOUGHT_SIGNATURE',
    'FINISH_REASON_UNSPECIFIED','MISSING','UNRECOGNIZED']),
};
const roots='supported|title|summary|concepts|slides|exercises|source|sources|citations';
const properties='title|label|explanation|anchorIds|anchorId|body|bullets|question|options|correctIndex|hint|anchors|digest|id|videoId';
const diagnosticPath=new RegExp(`^(?:${roots})(?:\\[\\d{1,3}\\])?(?:\\.(?:${properties})(?:\\[\\d{1,3}\\])?){0,5}$`,'u');
const actions=new Set(['generate','answer','ask','pptx','preparePptx','inspect','classify','catalogue','session','download']);
const codes=new Set(['authentication_required','invalid_provider_output','invalid_citation','unsupported_source','provider_unavailable','provider_temporarily_unavailable',
  'provider_not_configured','provider_billing_required','free_tier_quota_exhausted','free_route_not_verified','generation_disabled',
  'paid_route_not_verified','metered_route_required','project_budget_configuration_invalid','project_budget_unavailable','project_budget_exhausted',
  'credit_ledger_unavailable','credit_ledger_invalid','credit_operation_conflict','credit_operation_not_found','credit_ledger_capacity',
  'study_credit_exhausted','session_budget_unavailable','video_budget_exceeded','invalid_profile','invalid_memory','invalid_practice_evidence',
  'invalid_task_id','invalid_request','source_unavailable','invalid_answer','invalid_question','invalid_source','invalid_transcript','invalid_clip',
  'source_identity','source_too_large','invalid_lesson_token','expired_lesson','lesson_access_denied','export_too_large','download_expired',
  'invalid_classification_input','classification_unavailable','classification_busy','invalid_usage','invalid_credit_amount','invalid_credit_operation',
  'body_too_large','export_unavailable','study_unavailable']);

function own(value,key){
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  // Do not invoke accessors or copy prototypes, provider bodies or SDK errors.
  try{return Object.getOwnPropertyDescriptor(value,key)?.value;}catch{return undefined;}
}

export function sanitizeStudyDiagnostics(value){
  const safe={};
  for(const [key,allowed] of Object.entries(enums)){
    const item=own(value,key);if(allowed.has(item))safe[key]=item;
  }
  const path=own(value,'path');
  if(typeof path==='string'&&path.length<=160&&!/\s/u.test(path)&&diagnosticPath.test(path))safe.path=path;
  for(const key of ['retryable','transient','usageKnown']){
    const item=own(value,key);if(typeof item==='boolean')safe[key]=item;
  }
  for(const key of ['count','length','minimum','maximum']){
    const item=own(value,key);if(Number.isSafeInteger(item)&&item>=0&&item<=1000000)safe[key]=item;
  }
  const status=own(value,'httpStatus');
  if(Number.isInteger(status)&&status>=100&&status<=599)safe.httpStatus=status;
  return Object.freeze(safe);
}

export function createStudyFailureDiagnostic(action,error){
  const rawCode=own(error,'code'),status=own(error,'status');
  return Object.freeze({event:'delta_study_failure',reference:randomUUID(),action:actions.has(action)?action:'unknown',
    code:codes.has(rawCode)?rawCode:'study_unavailable',status:Number.isInteger(status)&&status>=400&&status<=599?status:503,
    diagnostics:sanitizeStudyDiagnostics(own(error,'diagnostics'))});
}

export function writeStudyDiagnostic(event){console.error(JSON.stringify(event));}
