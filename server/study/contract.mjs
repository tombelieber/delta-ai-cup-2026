import { StudyError } from './source.mjs';

const text = maximum => ({ type: 'STRING', description: `Non-blank text without disallowed control characters; at most ${maximum} UTF-16 code units before trimming.` });
const anchorId = () => ({ type: 'STRING', description: 'Use an anchor ID from the supplied captions only.' });
const array = (items,minItems,maxItems) => ({ type: 'ARRAY', items, minItems, maxItems });
const object = properties => ({ type: 'OBJECT', required: Object.keys(properties), properties });
export const STUDY_SCHEMA = object({ supported: { type: 'BOOLEAN' }, title: text(160), summary: text(700),
  concepts: array(object({ label: text(100), explanation: text(500), anchorIds: array(anchorId(),1,3) }),1,4),
  slides: array(object({ title: text(100), body: text(550), bullets: array(text(180),0,3), anchorId: anchorId() }),4,4),
  exercises: array(object({ question: text(750), options: array({...text(450),description:`${text(450).description} All three options must be distinct after trimming.`},3,3),
    correctIndex: { type: 'INTEGER', minimum: 0, maximum: 2 }, explanation: text(600), hint: text(350), anchorId: anchorId() }),2,2),
});
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
function check(condition,path,reason,details={},policy={}) {
  if(condition)return;
  const {kind='format',step='lesson_contract',code='invalid_provider_output',status=502,message=code}=policy;
  const error=new StudyError(code,status,message);
  error.diagnostics={step,kind,path,reason,retryable:kind==='format',...details};
  throw error;
}
function checked(value,maximum,path,policy) {
  check(typeof value==='string',path,'expected_string',{minimum:1,maximum},policy);
  check(value.length<=maximum,path,'string_too_long',{length:value.length,minimum:1,maximum},policy);
  check(Boolean(value.trim()),path,'blank_string',{length:value.length,minimum:1,maximum},policy);
  check(!controls.test(value),path,'disallowed_control_character',{length:value.length,minimum:1,maximum},policy);
  return value.trim();
}
function checkedArray(value,path,minimum,maximum,policy) {
  check(Array.isArray(value),path,'expected_array',{minimum,maximum},policy);
  check(value.length>=minimum&&value.length<=maximum,path,'array_count_out_of_range',{count:value.length,minimum,maximum},policy);
  return value;
}
function sourceIds(source) {
  const policy={kind:'source_integrity'};
  check(record(source),'source','invalid_source',{},policy);
  check(Array.isArray(source.anchors),'source.anchors','invalid_source',{},policy);
  return source.anchors.map((anchor,i)=>{
    check(record(anchor)&&typeof anchor.id==='string',`source.anchors[${i}].id`,'invalid_source',{},policy);
    return anchor.id;
  });
}
export function studySchemaForSource(source) {
  const ids=[...new Set(sourceIds(source))],schema=structuredClone(STUDY_SCHEMA),p=schema.properties;
  p.concepts.items.properties.anchorIds.items.enum=[...ids];
  p.slides.items.properties.anchorId.enum=[...ids];
  p.exercises.items.properties.anchorId.enum=[...ids];
  return schema;
}
export function validateStudyLesson(raw, source) {
  check(raw?.supported===true,'supported','unsupported_source',{},
    {kind:'source_integrity',code:'unsupported_source',status:422,message:'The source did not support a complete lesson.'});
  checkedArray(raw.concepts,'concepts',1,4);checkedArray(raw.slides,'slides',4,4);checkedArray(raw.exercises,'exercises',2,2);
  sourceIds(source);
  check(typeof source.digest==='string','source.digest','invalid_source',{}, {kind:'source_integrity'});
  const byId = new Map(source.anchors.map(a => [a.id, a]));
  const anchor = (id,path) => { check(byId.has(id),path,'unknown_anchor',{}, {kind:'source_integrity'}); return byId.get(id); };
  return { title: checked(raw.title,160,'title'), summary: checked(raw.summary,700,'summary'),
    concepts: raw.concepts.map((c,i) => {
      const p=`concepts[${i}]`;check(record(c),p,'expected_object');
      checkedArray(c.anchorIds,`${p}.anchorIds`,1,3).forEach((id,j)=>anchor(id,`${p}.anchorIds[${j}]`));
      return { id: `${source.digest.slice(0,12)}-c${i}`, label: checked(c.label,100,`${p}.label`), explanation: checked(c.explanation,500,`${p}.explanation`), anchorIds: [...new Set(c.anchorIds)] };
    }),
    slides: raw.slides.map((s,i) => {
      const p=`slides[${i}]`;check(record(s),p,'expected_object');const a=anchor(s.anchorId,`${p}.anchorId`);
      const bullets=checkedArray(s.bullets,`${p}.bullets`,0,3).map((b,j)=>checked(b,180,`${p}.bullets[${j}]`));
      return { title: checked(s.title,100,`${p}.title`), body: checked(s.body,550,`${p}.body`), bullets, anchorId:a.id, sourceTime:a.start };
    }),
    exercises: raw.exercises.map((e,i) => {
      const p=`exercises[${i}]`;check(record(e),p,'expected_object');const a=anchor(e.anchorId,`${p}.anchorId`);
      const options=checkedArray(e.options,`${p}.options`,3,3).map((o,j)=>checked(o,450,`${p}.options[${j}]`));
      const distinct=new Set(options).size;check(distinct===3,`${p}.options`,'duplicate_options',{count:distinct,minimum:3,maximum:3});
      check(Number.isInteger(e.correctIndex),`${p}.correctIndex`,'expected_integer',{minimum:0,maximum:2});
      check(e.correctIndex>=0&&e.correctIndex<=2,`${p}.correctIndex`,'integer_out_of_range',{minimum:0,maximum:2});
      return { id:`exercise-${i+1}`, question:checked(e.question,750,`${p}.question`), options, correctIndex:e.correctIndex,
        explanation:checked(e.explanation,600,`${p}.explanation`), hint:checked(e.hint,350,`${p}.hint`), anchorId:a.id, sourceTime:a.start };
    }),
  };
}
export function publicStudyLesson(lesson) {
  return { ...lesson, exercises: lesson.exercises.map(({correctIndex,explanation,hint,...exercise})=>exercise) };
}
export function resolveStudyCitations(citations, sources) {
  const policy={step:'citation_contract',code:'invalid_citation'};
  checkedArray(citations,'citations',1,6,policy);
  check(Array.isArray(sources),'sources','invalid_source',{}, {...policy,kind:'source_integrity'});
  return citations.map((c,i) => {
    const p=`citations[${i}]`;check(record(c),p,'expected_object',{},policy);
    const source=sources.find(s=>s?.videoId===c.videoId);
    check(Boolean(source),`${p}.videoId`,'unknown_source',{}, {...policy,kind:'source_integrity'});
    check(Array.isArray(source.anchors),'sources','invalid_source',{}, {...policy,kind:'source_integrity'});
    const anchor=source.anchors.find(a=>a?.id===c.anchorId);
    check(Boolean(anchor),`${p}.anchorId`,'unknown_anchor',{}, {...policy,kind:'source_integrity'});
    return { videoId:source.videoId, title:source.title, anchorId:anchor.id,start:anchor.start,end:anchor.end,
      url:`${source.videoUrl}&t=${Math.floor(anchor.start)}s` };
  });
}
