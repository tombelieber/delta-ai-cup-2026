import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createStudyClient,restoreStudySelection,studyVideoId,validateStudyInitialSource} from './study-client.mjs';
import {createStudyAuth} from './study-auth.mjs';
import StudyAccount from './StudyAccount.jsx';
import './study.css';

const stamp=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const cash=n=>Number(n).toFixed(4);
const initialProfile={level:'beginner',language:'en',interests:[]};
const memoryOf=item=>({lessonToken:item.lessonToken,feedbackTokens:(item.attempts||[]).filter(a=>a.feedbackToken).slice(-10).map(a=>a.feedbackToken)});
export default function StudyWorkspace(props){
  const endpoint=props.endpoint||'',selectedVideoId=studyVideoId(props.sourceVideo||props.initialSource),consumedInitial=useRef(null);
  const auth=useMemo(()=>createStudyAuth({endpoint,authConfig:props.authConfig,sourceVideo:{videoId:selectedVideoId}}),[endpoint,props.authConfig,selectedVideoId]);
  const [snapshot,setSnapshot]=useState(()=>({auth,state:auth.snapshot()}));
  const account=snapshot.auth===auth?snapshot.state:auth.snapshot();
  useEffect(()=>{const unsubscribe=auth.subscribe(state=>setSnapshot({auth,state}));void auth.initialize();return()=>{unsubscribe();auth.dispose();};},[auth]);
  const available=account.status==='local'||account.status==='signed-in',userId=account.user?.uid||'';
  const allowanceStatus=!account.enabled||account.quota?.remainingUsd>0?'available':account.quota?'exhausted':'unavailable';
  return <><StudyAccount key={endpoint} auth={auth} state={account}/>{available&&<StudyContent key={`${endpoint}:${userId||'local'}`} {...props} initialSource={consumedInitial.current===props.initialSource?null:props.initialSource} onInitialSourceConsumed={()=>{consumedInitial.current=props.initialSource;}} auth={account.enabled?auth:null} userId={userId} canSpend={!account.enabled||Boolean(account.quota?.remainingUsd>0)} allowanceStatus={allowanceStatus}/>}</>;
}
function StudyContent({endpoint='',sourceVideo,initialSource,onInitialSourceConsumed,onAuthorize,auth=null,userId='',canSpend=true,allowanceStatus='available'}){
  const client=useMemo(()=>createStudyClient({endpoint,userId,...(auth?{getToken:()=>auth.getToken(userId)}:{})}),[endpoint,userId,auth]);
  const [catalogue,setCatalogue]=useState([]),[library,setLibrary]=useState([]),[videoId,setVideoId]=useState('733mgqrzNKs');
  const [activeId,setActiveId]=useState(''),[profile,setProfile]=useState(initialProfile),[interest,setInterest]=useState('');
  const [busy,setBusy]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[slide,setSlide]=useState(0),[taskIndex,setTaskIndex]=useState(0),[choice,setChoice]=useState(null),[feedback,setFeedback]=useState(null);
  const [question,setQuestion]=useState(''),[answer,setAnswer]=useState(null),[upload,setUpload]=useState(null),[url,setUrl]=useState(''),[download,setDownload]=useState(null);
  const [sourceIssue,setSourceIssue]=useState('');
  const [sidebarOpen,setSidebarOpen]=useState(false),[focusTarget,setFocusTarget]=useState('');
  const lessonHeading=useRef(null),taskHeading=useRef(null),downloadLink=useRef(null);
  const epoch=useRef(0),running=useRef(false),source=useRef(sourceVideo||initialSource),initialHandled=useRef(null);source.current=sourceVideo||initialSource;
  const active=library.find(x=>x.lesson.id===activeId),lesson=active?.lesson,task=lesson?.exercises[taskIndex],pending=loading||Boolean(busy);
  const estimate=active?.cost?.available===false||!Number.isFinite(active?.cost?.conservativeUsd)?null:active.cost.conservativeUsd;
  useEffect(()=>{if(pending||!focusTarget)return;const target={lesson:lessonHeading.current,task:taskHeading.current,download:downloadLink.current}[focusTarget];if(target){target.focus();setFocusTarget('');}},[pending,focusTarget,lesson?.id,taskIndex,download]);
  async function refresh(current){const saved=await client.library();if(current())setLibrary(saved.items);return saved.items;}
  async function connect(){await run('connect',async current=>{await onAuthorize?.();const result=await client.catalogue();if(current())setCatalogue(result.sources||[]);});}
  useEffect(()=>{let mounted=true;epoch.current++;running.current=false;setLoading(true);setBusy('');setError('');setCatalogue([]);setLibrary([]);select();
    client.library().then(value=>{if(!mounted)return;const restored=restoreStudySelection(value.items,source.current);setLibrary(value.items);select(value.items.find(item=>item.lesson.id===restored.activeId),restored.videoId);}).catch(e=>mounted&&setError(e.message)).finally(()=>mounted&&setLoading(false));
    client.catalogue().then(value=>mounted&&setCatalogue(value.sources||[])).catch(e=>mounted&&setError(e.message));
    return()=>{mounted=false;epoch.current++;};},[client]);
  useEffect(()=>{if(sourceVideo?.videoId||sourceVideo?.url||sourceVideo?.videoUrl){const restored=restoreStudySelection(library,sourceVideo);select(library.find(item=>item.lesson.id===restored.activeId),restored.videoId);}},[sourceVideo?.videoId,sourceVideo?.url,sourceVideo?.videoUrl]);
  useEffect(()=>{if(loading||!initialSource||initialHandled.current===initialSource)return;initialHandled.current=initialSource;onInitialSourceConsumed?.();try{const prepared=validateStudyInitialSource(initialSource,sourceVideo);select(undefined,prepared.videoId);setUpload(prepared);setUrl(prepared.url);}catch(value){setSourceIssue(value.message);setError(value.message);}},[loading,initialSource]);
  function select(item,requestedVideoId=''){const restored=restoreStudySelection(item?[item]:[],requestedVideoId);epoch.current++;running.current=false;setActiveId(restored.activeId);setVideoId(restored.videoId);setProfile(restored.profile);setInterest(restored.interest);setUpload(null);setUrl(restored.videoId?`https://www.youtube.com/watch?v=${restored.videoId}`:'');setSourceIssue('');setSlide(0);setTaskIndex(0);setChoice(null);setFeedback(null);setQuestion('');setAnswer(null);setDownload(null);setError('');setBusy('');setFocusTarget('');if(item)setSidebarOpen(false);}
  async function run(name,action){if(running.current)return;running.current=true;const serial=++epoch.current;setBusy(name);setError('');try{await action(()=>serial===epoch.current);}catch(e){if(serial===epoch.current)setError(e.message);if(auth&&[401,403].includes(e.status))void auth.refreshSession().catch(()=>{});}finally{if(auth&&['generate','ask'].includes(name))void auth.refreshSession().catch(()=>{});if(serial===epoch.current){running.current=false;setBusy('');}}}
  useEffect(()=>()=>{if(download?.href.startsWith('blob:'))URL.revokeObjectURL(download.href);},[download]);
  useEffect(()=>{if(!download?.expiresAt||download.expired)return;const timeout=setTimeout(()=>setDownload(value=>value===download?{...value,expired:true}:value),Math.max(0,download.expiresAt-Date.now()));return()=>clearTimeout(timeout);},[download]);
  function downloadBlob(blob,name){setDownload({href:URL.createObjectURL(blob),name});setFocusTarget('download');}
  async function generate(){await run('generate',async current=>{
    const id=upload?.videoId||videoId;const result=await client.generate({videoId:id,profile:{...profile,interests:interest.split(',').map(x=>x.trim()).filter(Boolean).slice(0,5)},
      ...(upload?{transcript:upload.text,title:upload.title,start:upload.start,end:upload.end}:{}),memory:library.filter(x=>x.lesson.source.videoId!==id).slice(-4).map(memoryOf)});
    if(current()){await refresh(current);if(current()){setActiveId(result.lesson.id);setProfile(result.lesson.profile||initialProfile);setInterest((result.lesson.profile?.interests||[]).join(', '));setSlide(0);setTaskIndex(0);setChoice(null);setFeedback(null);setQuestion('');setAnswer(null);setDownload(null);setSidebarOpen(false);setFocusTarget('lesson');}}
  });}
  async function check(event){event.preventDefault();if(!active||!task||choice===null)return;await run('answer',async current=>{setFeedback(null);const result=await client.answer({lessonToken:active.lessonToken,taskId:task.id,choice});if(current()){setFeedback(result);await refresh(current);}});}
  async function ask(event){event.preventDefault();if(!active||!question.trim())return;await run('ask',async current=>{setAnswer(null);const result=await client.ask({lessonToken:active.lessonToken,question,memory:library.filter(x=>x.lesson.id!==lesson.id).slice(-4).map(memoryOf)});if(current()){setAnswer(result);await refresh(current);}});}
  async function prepareDownload(){await run('download',async current=>{setDownload(null);const value=await client.preparePptx({lessonToken:active.lessonToken});if(current()){setDownload(value);setFocusTarget('download');}else if(value.href.startsWith('blob:'))URL.revokeObjectURL(value.href);});}
  async function importCaption(event){const file=event.target.files?.[0];if(!file)return;try{if(file.size>250000)throw Error('Choose a caption text file under 250 KB.');let parsed;try{parsed=new URL(url);}catch{throw Error('Enter the matching YouTube URL first.');}
    const id=['youtube.com','www.youtube.com','m.youtube.com'].includes(parsed.hostname)&&parsed.pathname==='/watch'?parsed.searchParams.get('v'):parsed.hostname==='youtu.be'?parsed.pathname.slice(1):null;
    if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))throw Error('Enter a YouTube watch URL.');await run('import',async current=>{const text=await file.text(),prepared=validateStudyInitialSource({videoId:id,url,title:studyVideoId(sourceVideo)===id?sourceVideo?.title||id:id,transcript:text,start:0,end:300});if(current()){select(undefined,id);setUpload(prepared);}});
  }catch(e){setError(e.message);}}
  const selected=catalogue.find(x=>x.videoId===videoId);
  const selectedTitle=selected?.title||upload?.title||lesson?.source.title||(studyVideoId(sourceVideo)===videoId?sourceVideo?.title:null)||`YouTube video ${videoId}`;
  const downloadNotice=download&&<div role="status" className="study-download">
    {download.expired?<p>This download link expired. Prepare the PowerPoint again; no further AI request.</p>:<>
      <a ref={downloadLink} href={download.href} download={download.name}>Save {download.name}</a>
      <span>{download.expiresAt?'Ready for 90 seconds.':'Ready on this device.'} No further AI request.</span>
    </>}
  </div>;
  return <section className="study-workspace" lang="en" aria-busy={pending}>
    <header className="study-heading">
      <div><h1>Your learning workspace</h1><p>A video. A clearer idea. Something you can use.</p></div>
      <span className="study-local">Saved on this device</span>
    </header>
    {error&&<div role="alert" className="study-error">
      <div><strong>This step did not finish.</strong><p>{error}</p></div>
      <button type="button" disabled={pending} onClick={connect}>{busy==='connect'?'Connecting…':'Check connection'}</button>
    </div>}
    {lesson&&<button className="study-rail-toggle" type="button" aria-expanded={sidebarOpen} aria-controls="study-source-library" onClick={()=>setSidebarOpen(value=>!value)}>{sidebarOpen?'Close sources and saved learning':'Sources and saved learning'}</button>}
    <div className="study-layout">
      <aside id="study-source-library" className={`study-sidebar ${!lesson||sidebarOpen?'is-open':''}`}>
        <div className="study-sidebar-heading"><h2>Video sources</h2><p>Start with an excerpt or bring your own.</p></div>
        <div className="study-sources">
          {catalogue.map((source,index)=><button type="button" key={source.videoId} disabled={pending} aria-pressed={videoId===source.videoId} onClick={()=>{select(library.filter(item=>item.lesson.source.videoId===source.videoId).at(-1),source.videoId);setFocusTarget('lesson');}}>
            <span className="study-source-index">{String(index+1).padStart(2,'0')}</span>
            <strong>{source.title}</strong>
            <small className="study-source-meta">{stamp(source.start)}–{stamp(source.end)}</small>
          </button>)}
        </div>
        {videoId&&!selected&&<p className="study-selected-source">
          <strong>Selected YouTube source</strong>
          <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">{selectedTitle} ↗</a>
          <small>{upload?'Matching captions are ready.':'Add matching timestamped captions below.'}</small>
        </p>}
        <details><summary>Use another teaching video</summary>
          <p>Use Delta on the YouTube page to bring captions here, or import a matching timestamped transcript. A URL alone does not include captions.</p>
          <label>YouTube URL<input disabled={pending} value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…"/></label>
          <label>Caption text file<input disabled={pending} type="file" accept=".txt" onChange={importCaption}/></label>
        </details>
        <details><summary>Personalise the explanation</summary>
          <label>Your context<input disabled={pending} value={interest} onChange={event=>setInterest(event.target.value)} placeholder="e.g. running a small shop" maxLength={350}/></label>
          <label>Experience<select disabled={pending} value={profile.level} onChange={event=>setProfile(value=>({...value,level:event.target.value}))}><option value="beginner">Beginner</option><option value="some-experience">Some experience</option></select></label>
        </details>
        {upload&&<p className="study-caption-ready" role="status">Captions ready · {stamp(upload.start)}–{stamp(upload.end)}. Choose Generate lesson to continue.</p>}
        {!canSpend&&<p className="study-spend-notice" role="status">{allowanceStatus==='exhausted'?'Your AI allowance is used. Saved lessons, practice and downloads still work.':'Your AI allowance is unavailable. Saved lessons, practice and downloads still work.'}</p>}
        <button className="study-primary" type="button" disabled={pending||!canSpend||Boolean(sourceIssue)||(!selected&&!upload)} onClick={generate}>{busy==='generate'?'Creating your lesson…':lesson?'Create another explanation':'Generate lesson'}</button>
        <small className="study-budget-note">Uses Gemini and your AI allowance. Each generation must pass the US$0.10 session estimate.</small>
        {library.length>0&&<section className="study-library" aria-labelledby="study-library-title">
          <div className="study-sidebar-heading"><h2 id="study-library-title">Your saved learning</h2><span>{library.length}</span></div>
          {library.map(item=><button type="button" disabled={pending} key={item.lesson.id} aria-pressed={item.lesson.id===activeId} onClick={()=>{select(item);setSidebarOpen(false);setFocusTarget('lesson');}}>
            <strong>{item.lesson.title}</strong>
            <small>{item.attempts?.filter(attempt=>attempt.passed).length||0} exercise-key matches · {item.lesson.concepts.length} concepts encountered</small>
          </button>)}
          <button className="study-backup-button" type="button" disabled={pending} onClick={()=>downloadBlob(new Blob([JSON.stringify({schemaVersion:1,items:library},null,2)],{type:'application/json'}),'Delta-local-learning.json')}>Export local backup</button>
          <small>This backup includes private lessons and access data for your saved exercises. Keep it private.</small>
        </section>}
      </aside>
      <div className="study-main">
        {lesson&&<nav className="study-flow-nav" aria-label="Learning steps"><a href="#study-lesson">Lesson</a><a href="#study-practice">Practice</a><a href="#study-memory">Recall</a></nav>}
        {loading&&<p role="status" className="study-loading">Opening your saved learning…</p>}
        {!lesson&&<div className="study-empty" id="study-lesson">
          {downloadNotice}
          <span className="study-kicker">Ready when you are</span>
          <h2 ref={lessonHeading} tabIndex={-1}>{videoId?selectedTitle:'Choose a video to begin.'}</h2>
          <p>{!selected&&!upload?'Add matching timestamped captions to create a lesson from this video.':'Get a focused explanation, two application exercises and source-linked notes you can come back to.'}</p>
          <ul className="study-empty-steps"><li>Understand the idea</li><li>Try it in a new situation</li><li>Keep a PowerPoint and revisit the source</li></ul>
          {busy==='generate'&&<p role="status" className="study-generating">Gemini is preparing your lesson from the source…</p>}
        </div>}
        {lesson&&<>
          <section id="study-lesson" className="study-lesson" aria-labelledby="study-lesson-title">
            <div className="study-lesson-title">
              <div><span className="study-kicker">Lesson</span><h2 id="study-lesson-title" ref={lessonHeading} tabIndex={-1}>{lesson.title}</h2><p>{lesson.summary}</p></div>
              <div className="study-lesson-actions"><button type="button" disabled={pending} onClick={prepareDownload}>{busy==='download'?'Preparing…':'Download PPT + exercises'}</button>{downloadNotice}</div>
            </div>
            <article className="study-slide">
              <span className="study-slide-count">{slide+1} / {lesson.slides.length}</span>
              <h3>{lesson.slides[slide]?.title}</h3><p>{lesson.slides[slide]?.body}</p>
              <ul>{lesson.slides[slide]?.bullets.map((bullet,index)=><li key={index}>{bullet}</li>)}</ul>
              <a href={`${lesson.source.videoUrl}&t=${lesson.slides[slide]?.sourceTime}s`} target="_blank" rel="noreferrer">Source caption span · {stamp(lesson.slides[slide]?.sourceTime||0)} ↗</a>
              <nav aria-label="Lesson slides">{lesson.slides.map((item,index)=><button type="button" key={index} aria-label={`Slide ${index+1}: ${item.title}`} aria-current={index===slide?'step':undefined} onClick={()=>setSlide(index)}>{index+1}</button>)}</nav>
            </article>
            <div className="study-concepts" aria-label="Concepts encountered">{lesson.concepts.map(concept=><span key={concept.id}>{concept.label}<small>encountered</small></span>)}</div>
          </section>
          <section id="study-practice" className="study-practice" aria-labelledby="study-practice-title">
            <div className="study-section-header"><span className="study-kicker">Practice {taskIndex+1} of 2</span><h3 id="study-practice-title" ref={taskHeading} tabIndex={-1}>{taskIndex?'Try a new situation.':'Put the idea to work.'}</h3><p>Use the selected source’s assumptions and conventions.</p></div>
            <form onSubmit={check}><fieldset disabled={pending}><legend>{task?.question}</legend>
              {task?.options.map((option,index)=><label className="study-option" key={index}><input type="radio" name="study-choice" checked={choice===index} onChange={()=>{setChoice(index);setFeedback(null);}}/><span className="study-option-content">{option}</span></label>)}
            </fieldset><button className="study-primary" disabled={choice===null||pending} type="submit">{busy==='answer'?'Checking…':'Check my reasoning'}</button></form>
            {feedback&&<div role="status" className={`study-feedback ${feedback.passed?'passed':''}`}>
              <strong>{feedback.passed?'Matches the exercise key':'Try another approach'}</strong><p>{feedback.message}</p>{feedback.hint&&<p>Hint: {feedback.hint}</p>}
              <a href={feedback.sourceUrl} target="_blank" rel="noreferrer">Review source ↗</a>
              {feedback.passed&&taskIndex===0&&<button type="button" disabled={pending} onClick={()=>{setTaskIndex(1);setChoice(null);setFeedback(null);setFocusTarget('task');}}>Try the transfer exercise →</button>}
            </div>}
            <small>These exercises and answer keys were authored by AI. A matched answer is practice evidence, not a mastery or exam-score claim.</small>
          </section>
          <section id="study-memory" className="study-memory" aria-labelledby="study-memory-title">
            <div className="study-section-header"><span className="study-kicker">Learning memory</span><h3 id="study-memory-title">Connect it to what you saved.</h3><p>Your {library.length} saved lessons stay on this device. Only selected source context is sent when you ask.</p></div>
            <form className="study-memory-composer" onSubmit={ask}>
              <label htmlFor="study-question">Ask your learning memory</label>
              <textarea id="study-question" disabled={pending} value={question} maxLength={500} onChange={event=>{setQuestion(event.target.value);setAnswer(null);}} placeholder="Where did I learn why profit and cash are different?"/>
              <button className="study-primary" type="submit" disabled={!canSpend||!question.trim()||pending}>{busy==='ask'?'Finding source evidence…':'Find it in my learning'}</button>
            </form>
            {answer&&<div className="study-answer" role="status"><p>{answer.answer}</p>{answer.citations.map((citation,index)=><a key={index} href={citation.url} target="_blank" rel="noreferrer">{library.find(item=>item.lesson.source.videoId===citation.title)?.lesson.source.title||citation.title} · {stamp(citation.start)}–{stamp(citation.end)} ↗</a>)}</div>}
          </section>
          <aside className="study-cost"><strong>{estimate===null?'Paid-equivalent API estimate: unavailable':`Paid-equivalent API estimate: US$${cash(estimate)} / US$0.10`}</strong><span>Conservative standard rates · {lesson.model} · cache, practice checks and downloads avoid repeated generation.</span></aside>
          <details className="study-limitations"><summary>Source and learning evidence</summary><p>{lesson.source.title} · {lesson.source.captionType} captions</p><ul>{lesson.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul></details>
        </>}
      </div>
    </div>
  </section>;
}
