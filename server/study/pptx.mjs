export async function studyPptx(lesson){
  const {default:PptxGenJS}=await import('pptxgenjs');const pptx=new PptxGenJS();
  pptx.layout='LAYOUT_WIDE';pptx.author='Delta';pptx.title=lesson.title;pptx.subject='Caption-grounded learning material';
  pptx.theme={headFontFace:'Arial',bodyFontFace:'Arial',lang:lesson.profile.language==='zh-HK'?'zh-HK':'en-US'};
  function page(title,body,footer){const slide=pptx.addSlide();slide.background={color:'F5F7FC'};
    slide.addText('DELTA · LEARN IT. KEEP IT.',{x:.6,y:.35,w:10,h:.3,fontSize:11,bold:true,color:'4567D9'});
    slide.addText(title,{x:.6,y:1,w:12,h:1,fontSize:28,bold:true,color:'18233D',fit:'shrink'});
    slide.addText(body,{x:.6,y:2.15,w:12,h:3.8,fontSize:19,color:'253651',breakLine:true,fit:'shrink',valign:'top'});
    slide.addText(footer,{x:.6,y:6.65,w:12,h:.35,fontSize:10,color:'61718B'});return slide;}
  for(const item of lesson.slides){const slide=page(item.title,`${item.body}\n\n${item.bullets.map(b=>`• ${b}`).join('\n')}`,'AI-generated teaching; caption spans locate concepts, not independently verified claims.');
    slide.addText('Open source moment',{x:.6,y:6.15,w:4,h:.3,fontSize:12,color:'4567D9',hyperlink:{url:`${lesson.source.videoUrl}&t=${item.sourceTime}s`}});}
  lesson.exercises.forEach((e,i)=>page(`Apply it · ${i+1}`,`${e.question}\n\n${e.options.map((o,j)=>`${String.fromCharCode(65+j)}. ${o}`).join('\n\n')}`,'New application exercise created by Delta. Exercise-key matching does not certify mastery.'));
  page('Answer explanations',lesson.exercises.map((e,i)=>`${i+1}. ${String.fromCharCode(65+e.correctIndex)} — ${e.explanation}`).join('\n\n'),'AI-authored exercise keys; review uncertain material in the original video.');
  return {buffer:Buffer.from(await pptx.write({outputType:'nodebuffer',compression:true})),filename:`Delta-${lesson.source.videoId}.pptx`,contentType:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
}
