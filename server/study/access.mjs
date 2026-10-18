import {createHmac,timingSafeEqual} from 'node:crypto';
import {requireStudy} from './source.mjs';

const LOOPBACK_HOSTS=['127.0.0.1','localhost','[::1]'];
const LOOPBACK_ADDRESSES=['127.0.0.1','::1','::ffff:127.0.0.1'];

export function studySigningKey(env={}){
  if(Object.hasOwn(env,'LEARNING_SIGNING_KEY_BASE64')){
    const encoded=env.LEARNING_SIGNING_KEY_BASE64;
    const decoded=typeof encoded==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(encoded)?Buffer.from(encoded,'base64'):null;
    requireStudy(decoded?.length===32&&decoded.toString('base64')===encoded,'signing_configuration_invalid',503);
    return decoded;
  }
  requireStudy(!['guarded','google'].includes(env.STUDY_ACCESS_MODE),'signing_configuration_invalid',503);
  return env.LEARNING_SIGNING_KEY||env.GEMINI_API_KEY;
}

export function createStudyAccess({env={},key}={}){
  const mode=env.STUDY_ACCESS_MODE??'local';
  requireStudy(['local','guarded','google'].includes(mode),'study_configuration_invalid',503);
  let origin=null,token=null;
  if(mode!=='local'){
    let parsed;try{parsed=new URL(env.STUDY_ORIGIN);}catch{}
    requireStudy(parsed&&parsed.origin===env.STUDY_ORIGIN&&
      (parsed.protocol==='https:'||parsed.protocol==='http:'&&LOOPBACK_HOSTS.includes(parsed.hostname)),
      'study_configuration_invalid',503);
    requireStudy(Buffer.isBuffer(key)&&key.length===32,'signing_configuration_invalid',503);
    origin=parsed;
    if(mode==='guarded')token=createHmac('sha256',key).update('delta-study-private-access-v1').digest('base64url');
  }
  const accepts=value=>Boolean(token)&&typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)&&
    timingSafeEqual(Buffer.from(token),Buffer.from(value));
  return Object.freeze({mode,origin:origin?.origin||null,
    // Private setup tooling may read this capability. HTTP never returns it.
    ownerToken:()=>token,accepts,
    check(request,{download=false}={}){
      if(mode==='local'){
        let host;try{host=new URL(`http://${request.headers.host}`).hostname;}catch{}
        if(!LOOPBACK_HOSTS.includes(host)||!LOOPBACK_ADDRESSES.includes(request.socket.remoteAddress)||request.headers['sec-fetch-site']==='cross-site'){
          return {status:403,code:'local_study_required',message:'This prototype is available only on your local Delta service.'};
        }
      }else{
        const suppliedOrigin=request.headers.origin,fetchSite=request.headers['sec-fetch-site'];
        if(request.headers.host!==origin.host||suppliedOrigin!==undefined&&suppliedOrigin!==origin.origin||
          origin.protocol==='http:'&&!LOOPBACK_ADDRESSES.includes(request.socket.remoteAddress)||
          fetchSite!==undefined&&!['same-origin','none'].includes(fetchSite)){
          return {status:403,code:'study_origin_required',message:'Use the configured Delta learning page for this service.'};
        }
        if(mode==='guarded'&&!download&&!accepts(request.headers['x-delta-study-token'])){
          return {status:401,code:'study_access_required',message:'Connect your private learning access to continue.'};
        }
      }
      return null;
    },
  });
}
