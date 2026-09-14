import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {LearningRecovery} from './apps/web/src/LearningRecovery.tsx';
window.saved=[];window.previews=[];
const api={learningInbox:async()=>({nextCursor:null,items:[{itemId:'note',status:'PENDING',expiresAt:'2099-01-01',evidence:{question:'Original application question',answer:'45'}}]}),learningOutcomes:async()=>({groups:[]}),
previewLearningNote:async(id,input)=>{window.previews.push(input);return {scope:input.scope??'GLOBAL',applicationId:input.scope==='APPLICATION'?'original-application':null,currentValue:null,expectedCurrentVersionId:'00000000-0000-4000-8000-000000000001',display:input.otherLabel??input.answer};},
confirmLearningNote:async(id,input)=>{window.saved.push(input);return {changeSetId:'change',idempotentReplay:false};}};
createRoot(document.getElementById('root')).render(<LearningRecovery api={api}/>);
`},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'}});
const browser=await chromium.launch({headless:true});
try{
  for(const key of ["WORK_MODE_REQUIREMENT","START_DATE","HEARING_SOURCE","LAST_WORKING_DAY"]){
    const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<main id="root"></main>');await page.addScriptTag({content:bundle.outputFiles[0]!.text});
    await page.getByText('Review as a profile answer',{exact:true}).click();await page.getByLabel('Profile field',{exact:true}).selectOption(key);
    assert.equal(await page.getByRole('button',{name:'Review profile change',exact:true}).isDisabled(),true,'no guessed answer from the note');
    if(key==='WORK_MODE_REQUIREMENT')await page.getByLabel('Reviewed answer',{exact:true}).selectOption('NO');
    else if(key==='HEARING_SOURCE'){
      await page.getByLabel('Reviewed answer',{exact:true}).selectOption('OTHER');assert.equal(await page.getByRole('button',{name:'Review profile change'}).isDisabled(),true);
      await page.getByLabel('Other source').fill('<img src=x onerror=alert(1)>');
    }else await page.getByLabel('Reviewed answer',{exact:true}).fill('2026-10-20');
    if(key==='LAST_WORKING_DAY'){
      await page.getByRole('button',{name:'Review profile change'}).click();await page.getByRole('button',{name:'Confirm global default'}).waitFor();
      await page.getByLabel('Reuse scope').selectOption('APPLICATION');assert.equal(await page.getByRole('button',{name:'Confirm global default'}).count(),0,'scope change invalidates preview');
    }
    await page.getByRole('button',{name:'Review profile change'}).click();await page.getByText('Saving as: Original application only',{exact:true}).waitFor();
    assert.equal(await page.locator('img').count(),0);assert.equal(await page.getByRole('button',{name:'Confirm global default'}).count(),0);
    assert.deepEqual(await page.evaluate(()=>(window as unknown as {saved:unknown[]}).saved),[]);
    await page.getByRole('button',{name:'Confirm for original application'}).click();await page.getByText('Saved for the original application only. Other applications and global defaults are unchanged.',{exact:true}).waitFor();
    const [saved]=await page.evaluate(()=>(window as unknown as {saved:Array<Record<string,unknown>>}).saved);
    assert.equal(saved!.scope,'APPLICATION');assert.equal(saved!.confirmedGlobalDefault,false);assert.equal(saved!.expectedCurrentVersionId,'00000000-0000-4000-8000-000000000001');assert.equal('applicationId' in saved!,false,'application identity comes from the server-owned note');
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS scoped recovery UI: four typed fields, no inferred choice/date, explicit review, original-application-only confirmation, server version pinning, scope invalidation and inert other-source label. Synthetic API only.');
}finally{await browser.close();}
