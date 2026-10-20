// Recall is bounded to the signed lessons supplied by this caller. A source
// version is selected once, before both ranking and citation resolution.
const STOP_WORDS=new Set('a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our should that the their them then there these they this those to us was we were what when where which who why will with would you your'.split(' '));
const MAX_ANCHORS=16,MAX_TEXT_CHARS=14000;
const compareText=(a,b)=>a<b?-1:a>b?1:0;
const words=text=>new Set((text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu)||[]).filter(word=>!STOP_WORDS.has(word)));
const overlap=(question,text)=>{const terms=words(text);return [...question].filter(term=>terms.has(term)).length;};
const createdAt=lesson=>{const value=Date.parse(lesson.createdAt);return Number.isFinite(value)?value:0;};
const relevance=(a,b)=>b.textOverlap-a.textOverlap||b.labelOverlap-a.labelOverlap;
const anchorOrder=(a,b)=>relevance(a,b)||a.start-b.start||compareText(a.id,b.id);

export function retrieveStudyContext({question,primary,memory=[]}){
  const byVideo=new Map([[primary.source.videoId,primary]]);
  for(const lesson of memory){
    const videoId=lesson.source.videoId,previous=byVideo.get(videoId);
    if(videoId!==primary.source.videoId&&(!previous||createdAt(lesson)>=createdAt(previous)))byVideo.set(videoId,lesson);
  }
  const canonical=[...byVideo.values()],terms=words(question);
  const groups=canonical.map(lesson=>{
    const seen=new Set();
    const anchors=lesson.source.anchors.filter(anchor=>{
      if(seen.has(anchor.id))return false;seen.add(anchor.id);return true;
    }).map(anchor=>({...anchor,textOverlap:overlap(terms,anchor.text),
      labelOverlap:overlap(terms,lesson.concepts.filter(concept=>concept.anchorIds.includes(anchor.id)).map(concept=>concept.label).join(' ')),
    })).sort(anchorOrder);
    return {source:lesson.source,primary:lesson===primary,anchors,cursor:0};
  }).filter(group=>group.anchors.length).sort((a,b)=>relevance(a.anchors[0],b.anchors[0])||Number(b.primary)-Number(a.primary)||compareText(a.source.videoId,b.source.videoId));
  const memories=[];let size=0,selected;
  do{
    selected=false;
    for(const group of groups){
      while(group.cursor<group.anchors.length&&memories.length<MAX_ANCHORS){
        const anchor=group.anchors[group.cursor++];
        if(size+anchor.text.length>MAX_TEXT_CHARS)continue;
        memories.push({videoId:group.source.videoId,title:group.source.title,anchorId:anchor.id,text:anchor.text});
        size+=anchor.text.length;selected=true;break;
      }
      if(memories.length===MAX_ANCHORS)break;
    }
  }while(selected&&memories.length<MAX_ANCHORS);
  return {memories,sources:canonical.map(lesson=>lesson.source)};
}
