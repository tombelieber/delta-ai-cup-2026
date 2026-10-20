#!/usr/bin/env node
// Assemble public source only. Never push, deploy, infer, or read dotenv secrets.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstat,mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const DESTINATION=path.join(ROOT,'artifacts/competition-source');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:ROOT,maxBuffer:32*1024*1024});
const rootFiles=new Set(['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','vite.config.mjs','index.html','Dockerfile','.dockerignore','.env.example']);
const documentation=new Set(['architecture.md','architecture.svg','technologies.md','performance.md','source-audit.md','security-review.md','setup.md','store-listing.md','reviewer-instructions.md','payments.md','store-assets/README.md','store-assets/icon-128.png','store-assets/promo-440x280.png','store-assets/screenshot-recall-1280x800.png'].map(f=>`docs/submission/${f}`));
const licences=/^(?:LICEN[CS]E|COPYING|NOTICE)(?:[._-][A-Za-z0-9_-]+)?$/i;

export function allowSource(name){
  if(!/^[A-Za-z0-9_./-]+$/.test(name)||name.split('/').some(p=>!p||p==='..'))return false;
  return rootFiles.has(name)||documentation.has(name)||licences.test(name)
    || /^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:js|jsx|mjs|css|svg)$/.test(name)
    || /^server\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.mjs$/.test(name)
    || /^extension\/[A-Za-z0-9_.-]+\.(?:js|jsx|mjs|css|html|json)$/.test(name)
    || /^extension\/icons\/(?:delta\.svg|icon-(?:16|32|48|128)\.png)$/.test(name)
    || /^deploy\/competition\/(?:Dockerfile|[A-Za-z0-9_.-]+\.mjs)$/.test(name)
    || /^public\/episodes\/(?:anthropic|cursor|yc)\.jpg$/.test(name)
    || /^public\/(?:privacy|support)\.html$/.test(name)
    || name==='tools/submission/prepare-source.mjs'||name==='tools/benchmark/study-benchmark.mjs';
}

export function scanPublic(name,bytes){
  const text=bytes.toString('utf8');
  const checks=[
    ['private home path',/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//],
    ['private agent configuration',/\.(?:codex|agents|claude)\/[A-Za-z0-9_.-]+/],
    ['Google API credential',/AIza[0-9A-Za-z_-]{35}/],
    ['Stripe credential',/\b(?:[sr]k_(?:live|test)_[A-Za-z0-9]{24,}|whsec_[A-Za-z0-9]{24,})\b/],
    ['GitHub credential',/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
    ['AWS access identifier',/AKIA[0-9A-Z]{16}/],
    ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['bearer JWT',/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/],
    ['populated saved capability',/["'](?:lessonToken|feedbackToken)["']\s*:\s*["'][A-Za-z0-9_-]{80,}["']/],
  ];
  for(const [kind,pattern] of checks)assert(!pattern.test(text),`${name}: rejected ${kind}; value omitted.`);
  // Only these plainly synthetic invalid-URL cases are retained in tests.
  const fixture=/\.test\.(?:mjs|js|jsx)$/.test(name);
  for(const match of text.matchAll(/https?:\/\/[^\s/:@]+:[^\s/@]+@[^\s/'"`]+/g)){
    assert(fixture&&/^https?:\/\/(?:user|name):(?:pass|password|secret)@(?:localhost(?::\d+)?|(?:api\.|map\.)?example\.com|www\.youtube\.com)$/.test(match[0]),`${name}: rejected credential-bearing URL.`);
  }
}

export function publicEnvironment(bytes){
  const values=Object.fromEntries(bytes.toString('utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{
    const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(l);assert(match,'Environment example contains an unsupported line.');return [match[1],match[2]];
  }));
  for(const [key,value] of Object.entries(values)){
    if(/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/.test(key)&&!['GEMINI_API_KEY_RESOURCE','OLLAMA_KEEP_ALIVE'].includes(key)){
      assert(!value,`Environment example has a populated secret field: ${key}; value omitted.`);
    }
  }
  assert.equal(values.GEMINI_MODEL,'gemini-3.8-flash','Preserve the existing model; do not choose a fallback.');
  return Buffer.from(`# Public example. Credentials and deployment identifiers are intentionally empty.\n# Keep AI paused until the intended account, route and final candidate qualify.\nAI_GENERATION_DISABLED=true\nAI_PROVIDER=gemini\nGEMINI_MODEL=${values.GEMINI_MODEL}\nGEMINI_FREE_TIER_ONLY=true\nGEMINI_API_KEY=\nGEMINI_API_PROJECT=\nGEMINI_API_KEY_RESOURCE=\nGOOGLE_CLOUD_PROJECT=\nLEARNING_SIGNING_KEY_BASE64=\nGEMINI_BILLING_PAUSED=false\nHOST=127.0.0.1\nPORT=8787\nALLOWED_ORIGINS=\nALLOW_CHROME_EXTENSIONS=false\nMAX_ANALYSES_PER_HOUR=12\nSTUDY_ENABLED=false\nSTUDY_ACCESS_MODE=local\nSTUDY_ORIGIN=\nSTUDY_SOURCE_DIR=./artifacts/study/sources\nSTUDY_CACHE_DIR=./artifacts/study/cache\nFIREBASE_PROJECT_ID=\nFIREBASE_WEB_CONFIG=\nGOOGLE_APPLICATION_CREDENTIALS=\n`);
}

function options(argv){
  const result={inspectWorkspace:false};
  for(let i=0;i<argv.length;i++){
    if(['--inspect-workspace-for-prep','--inspect-workspace','--inspectworkspaceforprep'].includes(argv[i]))result.inspectWorkspace=true;
    else if(argv[i]==='--commit')result.commit=argv[++i];
    else if(argv[i]==='--output')result.output=argv[++i];
    else throw new Error('Usage: prepare-source.mjs --commit FULL_SHA --output artifacts/competition-source/NEW_NAME [--inspect-workspace-for-prep]');
  }
  assert(result.output,'A new --output directory is required.');
  if(result.commit)assert(/^[a-f0-9]{40}$/.test(result.commit),'--commit must be a full 40-character commit.');
  assert(result.inspectWorkspace||result.commit,'Final preparation requires explicit --commit; workspace inspection must be explicitly selected.');
  return result;
}

async function historicEvidence(){
  const result=[];
  const read=async name=>{try{const bytes=await readFile(path.join(ROOT,`artifacts/study/benchmark/${name}`));return {value:JSON.parse(bytes),sha256:hash(bytes)};}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const performance=await read('local-measurements.json'),cost=await read('cost-audit.json');
  if(performance&&cost){
    const p=performance.value,c=cost.value;
    assert(/^[a-f0-9]{40}$/.test(p.headCommit));assert.equal(c.combined.recordedAttempts,c.rows.reduce((n,r)=>n+r.entries.length,0));
    assert.equal(c.totalConservativeUsd,Number(c.rows.reduce((n,r)=>n+r.conservativeUsd,0).toFixed(9)));
    assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.startedAt));
    const count=value=>{assert(Number.isSafeInteger(value)&&value>=0);return value;};
    const outcomes=value=>{const successfulWithUsage=count(value.successfulWithUsage),recordedAttempts=count(value.recordedAttempts);assert(successfulWithUsage<=recordedAttempts);return {successfulWithUsage,recordedAttempts};};
    const measurements=p.measurements.map(m=>{
      assert(/^[a-z-]+$/.test(m.id));assert(m.attempts.every(a=>a.httpStatus===200&&Number.isFinite(a.milliseconds)&&a.milliseconds>=0));
      const ordered=m.attempts.map(a=>a.milliseconds).sort((a,b)=>a-b),middle=Math.floor(ordered.length/2);
      const median=Number((ordered.length%2?ordered[middle]:(ordered[middle-1]+ordered[middle])/2).toFixed(3));
      assert.equal(m.summary.medianMs,median);assert.equal(m.summary.minMs,ordered[0]);assert.equal(m.summary.maxMs,ordered.at(-1));
      return {id:m.id,samples:ordered.length,medianMs:median,minMs:ordered[0],maxMs:ordered.at(-1)};
    });
    result.push({name:'evidence/performance-snapshot.json',value:{schemaVersion:1,scope:'Historical isolated no-inference local benchmark; NOT current Google-authenticated or cloud latency.',
      sourceSnapshot:p.headCommit,sourceEvidenceSha256:performance.sha256,costEvidenceSha256:cost.sha256,measuredAt:p.startedAt,
      inferenceCalls:count(p.evidence.boundary.externalInferenceCalls),requestCount:count(p.contract.httpRequests),measurements,
      historicalGeneration:{lesson:outcomes(c.lesson),memory:outcomes(c.memory),combined:outcomes(c.combined),totalConservativeUsd:c.totalConservativeUsd},
      qualifications:'Five timed samples per path after warm-up. Memory path used a local model-boundary stub. Generation latency and learning efficacy were not measured.'}});
  }
  const audit=await read('source-audit.json');
  if(audit){
    const a=audit.value;assert(/^[a-f0-9]{40}$/.test(a.repository_head));
    const keys=['content_fields_checked','assertion_fields','verified','unsupported','needs_review','AI_authored_scenarios','intentional_distractors','citation_bundles','citation_bundles_verified','citation_bundles_needs_review','citation_reference_instances','citation_reference_instances_in_verified_bundles','citation_reference_instances_in_partial_bundles','unique_cited_anchors','declared_anchors_structurally_verified'];
    const counts=Object.fromEntries(keys.map(k=>{assert(Number.isSafeInteger(a.totals[k])&&a.totals[k]>=0);return [k,a.totals[k]];}));
    assert.equal(counts.verified+counts.unsupported+counts.needs_review,counts.assertion_fields);
    assert.equal(counts.assertion_fields+counts.AI_authored_scenarios+counts.intentional_distractors,counts.content_fields_checked);
    assert.equal(counts.citation_bundles_verified+counts.citation_bundles_needs_review,counts.citation_bundles);
    result.push({name:'evidence/source-audit-snapshot.json',value:{schemaVersion:1,scope:'Historical AI-assisted alignment of one fixed four-lesson corpus to supplied captions.',
      sourceSnapshot:a.repository_head,sourceEvidenceSha256:audit.sha256,counts,
      qualifications:'Field coverage and caption alignment, not model accuracy. No independent human, audio/video, private answer-key, learner-efficacy or external-standards verification. Original output/caption artifacts are excluded.'}});
  }
  return result;
}

function readme({head,inspectWorkspace,licenceNames}){
  return Buffer.from(`# Delta\n\nDelta connects YouTube viewing records, a personal topic map and caption-grounded learning. The learning lab turns an imported short captioned clip into four teaching slides, two AI-authored application exercises, source-linked recall and a seven-slide editable PowerPoint. Website and extension libraries remain separate.\n\n**Source status:** ${inspectWorkspace?'unqualified preparation snapshot of allowed workspace files':'clean source snapshot'} at base commit \`${head}\`. This archive contains source only and does not publish the private repository history. No deployment, Firebase setup, live provider call or learning outcome is qualified by the archive.\n\n## Run and verify\n\nUse Node.js 24+ and pnpm 11.25.0.\n\n\`\`\`sh\npnpm install --frozen-lockfile\npnpm test:server && pnpm test:extension\npnpm build && pnpm build:extension\n\`\`\`\n\nCopy the sanitized \`.env.example\` to ignored \`.env.local\`, run \`pnpm start\` for the API and \`pnpm dev\` in another terminal. Open \`http://127.0.0.1:5173\`. AI starts paused; the study API starts disabled. See [setup and configuration](docs/submission/setup.md) before enabling a private local study flow or configuring hosted access. Load \`extension-dist/\` as an unpacked Chrome 116+ extension after building. Historical download ZIPs are omitted.\n\n## Google sign-in and cost\n\nHosted study mode uses Firebase Google sign-in, server-verified UID isolation and a durable Firestore **US$0.50 lifetime AI allowance per verified Google UID**. The allowance does not reset daily. Google authentication, production ledger permissions and the final hosted candidate still require qualification. The extension sends hosted learning to the website; it does not transfer Google tokens or synchronize lessons.\n\nThe existing \`gemini-3.8-flash\` model and no-fallback/free-route safeguards are preserved. Credentials remain server-side. This package neither grants access to the maintainer's project nor authorizes billing/model changes. Conservative estimates and reservations are application controls, not provider-invoice or free-hosting guarantees.\n\n## Inputs and support limits\n\nThe four-video demonstration's local captions, saved lessons and capabilities are not included. A fresh clone does not automatically reproduce that demonstration. Import matching timestamped captions for the correct video and select a clip of at most five minutes; a pasted URL does not fetch captions. Generation needs separately verified private provider/signing configuration.\n\nExercises compare choices with AI-authored keys; they do not establish mastery, factual accuracy, financial advice or an IELTS score. Captions and generated teaching can be wrong. No retention or learner-improvement result is measured. [Architecture](docs/submission/architecture.md), [technologies](docs/submission/technologies.md), [historical performance](docs/submission/performance.md) and [source audit](docs/submission/source-audit.md) explain evidence and boundaries. Pages marked with the earlier source baseline retain that historical scope. Numeric \`evidence/\` snapshots, if present, describe their original snapshot and not current cloud latency.\n\n## Source package boundary\n\nNo \`.git\`, private history, environment secrets, raw captions, imported browsing history, local account tokens, saved lesson capabilities or historical media are bundled. The manifest lists every file and transformation; the separate receipt identifies the exact archive hash. Source preparation does not publish anything.\n\n${licenceNames.length?`Existing license/notice files are preserved: ${licenceNames.join(', ')}. No replacement license is chosen.`:'No existing tracked license file was found. This package does not select a license or add a permission/copyright assertion.'}\n`);
}

// Minimal deterministic USTAR: regular files only, numeric owner/group 0,
// epoch mtime, no workstation paths, names, symlinks, PAX or extended metadata.
export function sourceTar(files){
  const parts=[];
  for(const {name,bytes,mode=0o644} of files){
    assert(!name.startsWith('/')&&!name.split('/').includes('..'));
    const header=Buffer.alloc(512),put=(value,offset,length)=>{assert(Buffer.byteLength(value)<=(length));header.write(value,offset,length,'utf8');};
    let base=name,prefix='';if(Buffer.byteLength(name)>100){const split=name.lastIndexOf('/');prefix=name.slice(0,split);base=name.slice(split+1);}
    put(base,0,100);put(mode.toString(8).padStart(7,'0')+'\0',100,8);put('0000000\0',108,8);put('0000000\0',116,8);
    put(bytes.length.toString(8).padStart(11,'0')+'\0',124,12);put('00000000000\0',136,12);header.fill(32,148,156);
    put('0',156,1);put('ustar\0',257,6);put('00',263,2);put(prefix,345,155);
    const sum=header.reduce((n,b)=>n+b,0);put(sum.toString(8).padStart(6,'0')+'\0 ',148,8);
    parts.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));
  }
  return Buffer.concat([...parts,Buffer.alloc(1024)]);
}

export async function main(argv=process.argv.slice(2)){
  const option=options(argv),head=git('rev-parse','HEAD').toString().trim();
  if(option.commit)assert.equal(head,option.commit,'Final commit differs from explicitly pinned --commit.');
  const dirty=git('status','--porcelain=v1','--untracked-files=all').length>0;
  assert(option.inspectWorkspace||!dirty,'Working tree is dirty. Commit the final scoped candidate or explicitly select --inspect-workspace-for-prep.');
  const output=path.resolve(ROOT,option.output);
  assert(path.dirname(output)===DESTINATION&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(path.basename(output)),
    'Output must be a new direct child directory of artifacts/competition-source/.');
  const tracked=git('ls-tree','-rz',head).toString().split('\0').filter(Boolean).map(row=>{const [metadata,name]=row.split('\t');const [mode,type]=metadata.split(' ');return {name,mode,type};});
  const trackedMap=new Map(tracked.map(f=>[f.name,f]));
  const names=option.inspectWorkspace?git('ls-files','--cached','--others','--exclude-standard','-z').toString().split('\0').filter(Boolean):tracked.map(f=>f.name);
  const selected=[...new Set(names.filter(allowSource))].sort();
  for(const name of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','index.html','vite.config.mjs','server/index.mjs','extension/manifest.json','.env.example','docs/submission/setup.md'])assert(selected.includes(name),`Required source input missing: ${name}`);
  const entries=[];
  for(const name of selected){
    let bytes,mode;
    if(option.inspectWorkspace){const file=path.join(ROOT,name),stat=await lstat(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&await realpath(file)===file,`Only ordinary source files are allowed: ${name}`);bytes=await readFile(file);mode=stat.mode&0o111?0o755:0o644;}
    else {const input=trackedMap.get(name);assert(input.type==='blob'&&['100644','100755'].includes(input.mode),`Only ordinary tracked files are allowed: ${name}`);bytes=git('show',`${head}:${name}`);mode=input.mode==='100755'?0o755:0o644;}
    assert(bytes.length<2*1024*1024,`Source input exceeds the public-package bound: ${name}`);
    entries.push({name,bytes,mode,sourceSha256:hash(bytes),transformation:null});
  }
  const allowed=new Set(selected);
  for(const entry of entries){
    if(entry.name==='.env.example'){entry.bytes=publicEnvironment(entry.bytes);entry.transformation='paused empty-secret public example; owner deployment identifiers removed';}
    else if(documentation.has(entry.name)&&entry.name.endsWith('.md')){
      let omitted=0;
      const body=entry.bytes.toString().replace(/\[([^\]]+)\]\(([^\s)]+)\)/g,(all,label,target)=>{
        if(/^(?:https?:|#)/.test(target))return all;
        const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(entry.name),target.split('#')[0]));
        if(allowed.has(resolved))return all;omitted++;return `${label} (historical maintainer reference; not bundled)`;
      });
      if(omitted){entry.bytes=Buffer.from(body);entry.transformation=`${omitted} links to excluded maintainer records rendered as unbundled historical references`;}
    }
  }
  entries.push({name:'README.md',bytes:readme({head,inspectWorkspace:option.inspectWorkspace,licenceNames:selected.filter(n=>licences.test(n))}),mode:0o644,transformation:'generated public product and setup overview'});
  entries.push({name:'.gitignore',bytes:Buffer.from('node_modules/\ndist/\nextension-dist/\nartifacts/\n.env\n.env.*\n!.env.example\n*.log\n.app-canvas/\n'),mode:0o644,transformation:'generated private-data exclusions'});
  const evidence=await historicEvidence();
  for(const item of evidence)entries.push({name:item.name,bytes:Buffer.from(JSON.stringify(item.value,null,2)+'\n'),mode:0o644,transformation:'validated numeric historical evidence only; original source text and local paths excluded'});
  entries.sort((a,b)=>a.name.localeCompare(b.name,'en'));
  for(const entry of entries)scanPublic(entry.name,entry.bytes);
  const files=entries.map(e=>({path:e.name,bytes:e.bytes.length,sha256:hash(e.bytes),mode:e.mode.toString(8),...(e.sourceSha256?{sourceSha256:e.sourceSha256}:{}),...(e.transformation?{transformation:e.transformation}:{})}));
  const manifest={schemaVersion:1,sourceBaseCommit:head,status:option.inspectWorkspace?'unqualified-workspace-preparation':'clean-committed-source',workspaceDirty:dirty,
    published:false,deploymentQualified:false,historyIncluded:false,filesSha256:hash(JSON.stringify(files)),historicalNumericEvidence:evidence.map(e=>e.name),files};
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');scanPublic('source-manifest.json',manifestBytes);
  // Reject a concurrent input change instead of producing a mixed snapshot.
  assert.equal(git('rev-parse','HEAD').toString().trim(),head,'HEAD changed during preparation.');
  if(option.inspectWorkspace){for(const entry of entries.filter(e=>e.sourceSha256))assert.equal(hash(await readFile(path.join(ROOT,entry.name))),entry.sourceSha256,`Input changed during preparation: ${entry.name}`);}
  else assert.equal(git('status','--porcelain=v1','--untracked-files=all').length,0,'Working tree changed during final preparation.');
  await mkdir(DESTINATION,{recursive:true,mode:0o700});assert.equal(await realpath(DESTINATION),DESTINATION,'Output root cannot be a symlink.');
  await mkdir(output,{mode:0o700});const tree=path.join(output,'source');await mkdir(tree,{mode:0o700});
  for(const entry of [...entries,{name:'source-manifest.json',bytes:manifestBytes,mode:0o644}]){const target=path.join(tree,entry.name);await mkdir(path.dirname(target),{recursive:true,mode:0o755});await writeFile(target,entry.bytes,{flag:'wx',mode:entry.mode});}
  const archive=gzipSync(sourceTar([...entries,{name:'source-manifest.json',bytes:manifestBytes}].map(e=>({...e,name:`delta-source/${e.name}`}))),{level:9});
  await writeFile(path.join(output,'delta-source.tar.gz'),archive,{flag:'wx',mode:0o600});
  const receipt={schemaVersion:1,status:manifest.status,sourceBaseCommit:head,files:files.length,filesSha256:manifest.filesSha256,archive:'delta-source.tar.gz',archiveBytes:archive.length,archiveSha256:hash(archive),manifestSha256:hash(manifestBytes),published:false,deploymentQualified:false};
  await writeFile(path.join(output,'package-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(receipt,null,2));return receipt;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){main().catch(error=>{console.error(`Public source preparation stopped: ${error.message}`);process.exitCode=1;});}
