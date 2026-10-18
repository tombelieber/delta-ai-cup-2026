import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from './index.mjs';
import {StudyError} from './study/source.mjs';
import http from 'node:http';
async function setup(t,enabled=true){const studyService=enabled?{catalogue:async()=>({sources:[],storage:'browser-local'}),generate:async()=>({lesson:{title:'Actual route'}}),answer:async()=>{throw new StudyError('invalid_lesson_token');}}:null;
  const server=createServer({studyService});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}`;}
test('study routes are opt-in and preserve application error codes',async t=>{
  const origin=await setup(t);assert.equal((await fetch(`${origin}/api/study/catalogue`)).status,200);
  const response=await fetch(`${origin}/api/study/answer`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(response.status,400);assert.equal((await response.json()).error,'invalid_lesson_token');
  const disabled=await setup(t,false);assert.equal((await fetch(`${disabled}/api/study/catalogue`)).status,404);
});
test('study endpoints reject cross-site callers and DNS rebinding hosts',async t=>{
  const origin=await setup(t);assert.equal((await fetch(`${origin}/api/study/catalogue`,{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  const status=await new Promise((resolve,reject)=>{const url=new URL(origin);http.get({hostname:url.hostname,port:url.port,path:'/api/study/catalogue',headers:{host:'attacker.invalid'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);});
  assert.equal(status,403);
});
