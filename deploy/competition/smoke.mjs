import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--candidate') throw new Error('Usage: node deploy/competition/smoke.mjs --candidate artifacts/competition/CANDIDATE');
const candidate = path.resolve(args[1]), image = JSON.parse(await readFile(path.join(candidate, 'image-receipt.json'), 'utf8'));
// A throwaway test key is inherited by docker, never placed in arguments,
// image layers, a receipt or a host environment file. No provider key is used.
const smokeEnv = { ...process.env, LEARNING_SIGNING_KEY_BASE64: randomBytes(32).toString('base64') };
const container = execFileSync('docker', ['run', '--detach', '--rm', '--network', 'none', '--read-only',
  '--tmpfs', '/app/artifacts/study/cache:uid=1000,gid=1000,mode=700,size=16777216',
  '--env', 'LEARNING_SIGNING_KEY_BASE64', '--env', 'STUDY_ACCESS_MODE=local', '--env', 'AI_GENERATION_DISABLED=true',
  '--env', 'AI_PROVIDER=gemini', '--env', 'GEMINI_MODEL=gemini-3.8-flash', image.imageId], { encoding: 'utf8', env: smokeEnv }).trim();
try {
  const code = `
    import assert from 'node:assert/strict';
    import {createHash} from 'node:crypto';
    import {readFile,readdir,writeFile,unlink,stat} from 'node:fs/promises';
    const origin='http://127.0.0.1:8080',checks=[];
    let health;
    for(let attempt=0;attempt<100;attempt++){
      try{health=await fetch(origin+'/api/health');if(health.ok)break;}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(health?.status,200);checks.push('real-entrypoint-health');
    assert.equal(process.getuid(),1000);checks.push('nonroot-node-user');
    const cache=process.env.STUDY_CACHE_DIR;
    const marker=cache+'/permission-probe';await writeFile(marker,'probe',{mode:0o600});
    assert.equal((await stat(marker)).uid,1000);await unlink(marker);checks.push('writable-private-cache');
    const page=await fetch(origin+'/learn?study=1');assert.equal(page.status,200);
    assert.match(await page.text(),/<html/);checks.push('canonical-web-route');
    const response=await fetch(origin+'/api/study/catalogue');assert.equal(response.status,200);
    const catalogue=await response.json();
    assert.deepEqual(catalogue.sources.map(s=>s.videoId).sort(),['733mgqrzNKs','DiVPAjgmnj0','dI8w0utjUc0','rXVR-nE2jvw'].sort());
    assert(catalogue.sources.every(s=>s.anchors.length&&s.anchors.every(a=>!Object.hasOwn(a,'text'))));
    checks.push('four-real-private-caption-sources-without-text');
    assert.equal((await fetch(origin+'/api/study/catalogue',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
    checks.push('cross-site-denied');
    for(const route of ['/.env','/.env.local','/server/study/service.mjs','/private/study-sources/733mgqrzNKs.txt','/artifacts/study/cache','/candidate-input.json']){
      assert.equal((await fetch(origin+route)).status,404,route);
    }
    checks.push('private-paths-not-served');
    const invalid=await fetch(origin+'/api/study/inspect',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(invalid.status,400);assert.equal((await invalid.json()).error,'invalid_lesson_token');
    checks.push('invalid-lesson-token-denied');
    const disabled=await fetch(origin+'/api/study/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({videoId:'733mgqrzNKs',profile:{language:'en',level:'beginner',interests:[]}})});
    assert.equal(disabled.status,503);assert.equal((await disabled.json()).error,'generation_disabled');
    assert((await readdir(cache)).some(name=>name.endsWith('.meta.json')));
    checks.push('generation-disabled-before-provider-network');
    const extension=JSON.parse(await readFile('/app/release/extension-package.json','utf8'));
    const zip=await fetch(origin+'/downloads/'+extension.filename);assert.equal(zip.status,200);
    const bytes=Buffer.from(await zip.arrayBuffer());assert.equal(bytes.length,extension.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),extension.sha256);
    const manifest=JSON.parse(await readFile('/app/release/extension-dist/manifest.json','utf8'));
    assert.equal(manifest.manifest_version,3);assert.equal(manifest.version,extension.version);
    checks.push('exact-mv3-zip-download');
    console.log(JSON.stringify({checks,network:'none',runtimeUid:process.getuid(),studyAccessMode:'local',providerCalls:0}));
  `;
  const result = JSON.parse(execFileSync('docker', ['exec', '--interactive', container, 'node', '--input-type=module'], { input: code, encoding: 'utf8', timeout: 30000 }));
  const receipt = { schemaVersion: 1, imageId: image.imageId, candidateInputSha256: image.candidateInputSha256,
    ...result, googleAuthenticationQualified: false, published: false };
  await writeFile(path.join(candidate, 'smoke-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(receipt));
} finally { execFileSync('docker', ['rm', '--force', container], { stdio: 'ignore' }); }
