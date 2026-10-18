import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {parseStudySource} from './source.mjs';

export const STUDY_CANDIDATES=Object.freeze([
  {videoId:'dI8w0utjUc0',title:'SUMIF and SUMIFS in Microsoft Excel',topic:'Excel',start:35,end:186},
  {videoId:'733mgqrzNKs',title:'Time value of money — Khan Academy',topic:'Finance',start:0,end:300},
  {videoId:'DiVPAjgmnj0',title:'The CASH FLOW STATEMENT for BEGINNERS — Accounting Stuff',topic:'Accounting',start:0,end:300},
  {videoId:'rXVR-nE2jvw',title:'How To Write A Band 9 Task 2 Main Body Paragraph — IELTS Advantage',topic:'English writing',start:0,end:300},
]);
export async function loadStudySources(directory){
  return (await Promise.all(STUDY_CANDIDATES.map(async candidate=>{
    try{return parseStudySource({...candidate,text:await readFile(path.join(directory,`${candidate.videoId}.txt`),'utf8')});}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
  }))).filter(Boolean);
}
