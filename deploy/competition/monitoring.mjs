// Public, non-AI availability checks. Notification addresses are supplied by
// the operator and never belong in source or check URLs.
export const DELTA_MONITOR_TARGETS=Object.freeze([
  {slug:'onboarding',name:'Delta onboarding',host:'delta-511903.web.app',path:'/',contains:'Delta'},
  {slug:'learning',name:'Delta learning page',host:'delta-assistant-613646062582.us-central1.run.app',path:'/learn?study=1',contains:'Delta'},
  {slug:'auth-config',name:'Delta public auth configuration',host:'delta-assistant-613646062582.us-central1.run.app',path:'/api/study/auth-config',contains:'"enabled":true'},
]);
const requireValue=(condition,message)=>{if(!condition)throw Error(message);};
export function deltaUptimeDefinitions({projectId='delta-511903',periodSeconds=300}={}){
  requireValue(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId),'Invalid monitoring project');
  requireValue([300,600,900].includes(periodSeconds),'Use a bounded 5, 10 or 15 minute interval');
  return DELTA_MONITOR_TARGETS.map(target=>({displayName:target.name,
    monitoredResource:{type:'uptime_url',labels:{project_id:projectId,host:target.host}},
    httpCheck:{requestMethod:'GET',path:target.path,port:443,useSsl:true,validateSsl:true,
      acceptedResponseStatusCodes:[{statusClass:'STATUS_CLASS_2XX'}]},
    period:`${periodSeconds}s`,timeout:'15s',selectedRegions:['USA'],
    contentMatchers:[{content:target.contains,matcher:'CONTAINS_STRING'}],
    userLabels:{product:'delta',surface:target.slug},
  }));
}
export function deltaUptimePolicy({projectId='delta-511903',checkNames,channelNames}={}){
  requireValue(Array.isArray(checkNames)&&checkNames.length===3&&new Set(checkNames).size===3,'Three exact Delta check names are required');
  requireValue(Array.isArray(channelNames)&&channelNames.length>0&&channelNames.length<=3,'An owned notification channel is required');
  const prefix=`projects/${projectId}/`;
  requireValue(checkNames.every(n=>n.startsWith(`${prefix}uptimeCheckConfigs/`)&&/^[A-Za-z0-9_-]+$/.test(n.slice(n.lastIndexOf('/')+1))),'Invalid uptime-check scope');
  requireValue(channelNames.every(n=>n.startsWith(`${prefix}notificationChannels/`)&&/^\d+$/.test(n.slice(n.lastIndexOf('/')+1))),'Invalid notification-channel scope');
  const scope=checkNames.map(n=>`metric.label.check_id="${n.slice(n.lastIndexOf('/')+1)}"`).join(' OR ');
  return {displayName:'Delta public availability',enabled:true,combiner:'OR',userLabels:{product:'delta'},
    documentation:{mimeType:'text/markdown',content:'Two USA checkers failed the same public Delta surface for five minutes. Check onboarding, the learning page and public auth configuration. These probes do not sign in, generate AI, read user content or prove authenticated end-to-end availability. Do not use legacy /api/health denial as a Study incident.'},
    conditions:[{displayName:'Two regions fail the same Delta check',conditionThreshold:{
      filter:`metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND resource.type="uptime_url" AND (${scope})`,
      aggregations:[{alignmentPeriod:'300s',perSeriesAligner:'ALIGN_NEXT_OLDER',crossSeriesReducer:'REDUCE_COUNT_FALSE',groupByFields:['metric.label.check_id']}],
      comparison:'COMPARISON_GT',thresholdValue:1,duration:'300s',trigger:{count:1},evaluationMissingData:'EVALUATION_MISSING_DATA_ACTIVE',
    }}],notificationChannels:channelNames,alertStrategy:{autoClose:'86400s'},
  };
}
