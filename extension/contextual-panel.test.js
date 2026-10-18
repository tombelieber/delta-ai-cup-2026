import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const service='https://delta-assistant-613646062582.us-central1.run.app';
async function render(props={},component="default"){
  const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,entries:[],include:[]},server:{middlewareMode:true,watch:null,hmr:false},logLevel:'error'});
  try{
    const module=await server.ssrLoadModule('/extension/ContextualPanel.jsx'),Panel=module[component];
    return renderToStaticMarkup(React.createElement(Panel,{data:{videos:{},recordingEnabled:true,goal:''},apiEndpoint:service,libraryClient:{async list(){return {}; }},onRetry(){},onEndpointChange(){},onSelectVideo(){},onToggleRecording(){},onGoalChange(){},...props}));
  }finally{await server.close();}
}

test('fresh history immediately offers canonical learning for the current non-pilot video',async()=>{
  const html=await render({live:{videoId:'DiVPAjgmnj0',title:'Cash flow'}});
  assert.match(html,/Learn current video/);
  assert.match(html,/captions/i);
  assert.doesNotMatch(html,/Open the supported SUMIF video/);
});

test('an invalid or absent current video cannot start caption capture',async()=>{
  for(const live of [null,{videoId:'invalid',title:'Bad video'}]){
    const html=await render({live});
    assert.doesNotMatch(html,/Learn current video/);
  }
});

test('a saved unsupported endpoint is preserved with an explicit hosted-service recovery',async()=>{
  const html=await render({apiEndpoint:'https://old-private.example'});
  assert.match(html,/https:\/\/old-private.example/);
  assert.match(html,/Use hosted Delta service/);
});

test('saved SUMIF entry keeps its legacy controls but new generation is disabled',async()=>{
  const html=await render({videoId:'dI8w0utjUc0',items:[{videoId:'dI8w0utjUc0',hasLesson:true}],source:{url:'https://www.youtube.com/watch?v=dI8w0utjUc0',start:35,end:186},client:{},storage:{async get(){return null;},async set(){}}},'SavedLearningWorkspace');
  assert.match(html,/Delta learning assistant/);
  assert.match(html,/id="live-generation-paused"/);
});

test('an enrollment without a saved lesson never opens legacy generation',async()=>{
  const html=await render({videoId:'dI8w0utjUc0',items:[{videoId:'dI8w0utjUc0',hasLesson:false}],client:{}},'SavedLearningWorkspace');
  assert.equal(html,'');
});
