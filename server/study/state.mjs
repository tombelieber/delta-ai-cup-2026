import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {requireStudy,StudyError} from './source.mjs';

export function createStudyState({directory,key,now=Date.now}) {
  requireStudy(key,'signing_configuration_invalid',503);
  const encryptionKey=createHash('sha256').update('delta-study-v1\0').update(key).digest();
  function seal(lesson){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);
    const encrypted=Buffer.concat([cipher.update(JSON.stringify({v:1,expiresAt:now()+7*86400000,lesson})),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');}
  function open(token,{ownerUid}={}){
    requireStudy(typeof token==='string'&&token.length>=80&&token.length<=100000&&/^[A-Za-z0-9_-]+$/.test(token),'invalid_lesson_token');
    try{const bytes=Buffer.from(token,'base64url'),decipher=createDecipheriv('aes-256-gcm',encryptionKey,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));
      const parsed=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());
      requireStudy(parsed.v===1&&Number.isFinite(parsed.expiresAt)&&parsed.lesson?.id,'expired_lesson');
      if(ownerUid!==undefined)requireStudy(typeof ownerUid==='string'&&ownerUid.length>0&&ownerUid.length<=128&&parsed.lesson.ownerUid===ownerUid,'lesson_access_denied',403);
      requireStudy(parsed.expiresAt>now()||ownerUid!==undefined,'expired_lesson');return parsed.lesson;
    }catch(error){if(error instanceof StudyError)throw error;throw new StudyError('invalid_lesson_token');}
  }
  const filename=(id,suffix)=>{requireStudy(/^[a-f0-9]{64}$/.test(id),'invalid_cache_key');return path.join(directory,`${id}.${suffix}.json`);};
  async function read(id,suffix){try{return JSON.parse(await readFile(filename(id,suffix),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  async function write(id,suffix,value){await mkdir(directory,{recursive:true,mode:0o700});const target=filename(id,suffix),temp=`${target}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temp,target);}
  function budget(id,{enforceLimit=true}={}){let current=null,latest=-1;
    const get=async()=>current??=(await read(id,'cost'))||{conservativeUsd:0,entries:[]};
    const check=async amount=>{const state=await get();requireStudy(Number.isFinite(amount)&&amount>=0&&(!enforceLimit||state.conservativeUsd+amount<.1),'video_budget_exceeded',429,'This video has reached its US$0.10 generation budget. Saved results remain available.');return state;};
    return {check,async reserve(amount){const state=await check(amount);
        latest=state.entries.length;state.entries.push({reservedUsd:amount,actualUsd:null});state.conservativeUsd=Number((state.conservativeUsd+amount).toFixed(9));await write(id,'cost',state);},
      async settle(amount,usage){const state=await get();requireStudy(latest>=0&&Number.isFinite(amount)&&amount>=0,'invalid_usage',502);const entry=state.entries[latest];state.conservativeUsd=Number((state.conservativeUsd-entry.reservedUsd+amount).toFixed(9));Object.assign(entry,{actualUsd:amount,usage});await write(id,'cost',state);
        requireStudy(!enforceLimit||state.conservativeUsd<.1,'video_budget_exceeded',429,'The provider reported usage above this video’s US$0.10 budget. Further generation is stopped; saved work is kept.');},
      async failure(diagnostics){const state=await get();if(latest>=0)state.entries[latest].failure=diagnostics;await write(id,'cost',state);},
      async value(){return structuredClone(await get());},};
  }
  return {seal,open,read,write,budget};
}
