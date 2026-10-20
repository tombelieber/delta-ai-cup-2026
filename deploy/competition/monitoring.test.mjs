import test from 'node:test';
import assert from 'node:assert/strict';
import {deltaUptimeDefinitions,deltaUptimePolicy} from './monitoring.mjs';

test('availability probes are bounded public HTTPS GETs with content checks and no AI or credentials',()=>{
  const checks=deltaUptimeDefinitions();assert.equal(checks.length,3);
  for(const c of checks){assert.equal(c.period,'300s');assert.equal(c.timeout,'15s');assert.equal(c.httpCheck.useSsl,true);assert.equal(c.httpCheck.validateSsl,true);assert.equal(c.httpCheck.requestMethod,'GET');assert.equal(c.contentMatchers.length,1);assert.deepEqual(c.selectedRegions,['USA']);assert.equal(c.monitoredResource.labels.project_id,'delta-511903');assert.ok(!/generate|session|Bearer|token|request=|key=/.test(JSON.stringify(c)));}
  assert.equal(31*24*12*3*3,80352);
  assert.throws(()=>deltaUptimeDefinitions({periodSeconds:60}));
});
test('incident policy scopes all three exact checks and requires two failed regions per check',()=>{
  const names=['a','b','c'].map(id=>`projects/delta-511903/uptimeCheckConfigs/${id}`),channels=['projects/delta-511903/notificationChannels/123'];
  const p=deltaUptimePolicy({checkNames:names,channelNames:channels}),c=p.conditions[0].conditionThreshold;
  assert.equal(p.enabled,true);assert.deepEqual(p.notificationChannels,channels);assert.equal(c.thresholdValue,1);assert.equal(c.comparison,'COMPARISON_GT');assert.equal(c.duration,'300s');assert.equal(c.aggregations[0].crossSeriesReducer,'REDUCE_COUNT_FALSE');assert.deepEqual(c.aggregations[0].groupByFields,['metric.label.check_id']);
  for(const id of ['a','b','c'])assert.ok(c.filter.includes(`metric.label.check_id="${id}"`));
  assert.equal(c.evaluationMissingData,'EVALUATION_MISSING_DATA_ACTIVE');
});
test('monitoring cannot silently broaden to other projects or omit notification delivery',()=>{
  const names=['a','b','c'].map(id=>`projects/delta-511903/uptimeCheckConfigs/${id}`);
  assert.throws(()=>deltaUptimePolicy({checkNames:names,channelNames:[]}));
  assert.throws(()=>deltaUptimePolicy({checkNames:names.map(n=>n.replace('delta-511903','other-project')),channelNames:['projects/delta-511903/notificationChannels/123']}));
  assert.throws(()=>deltaUptimePolicy({checkNames:names,channelNames:['projects/other-project/notificationChannels/123']}));
});
