import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { adminFixture } from "../apps/api/src/admin-test-fixture.js";

// Real API + complete database schema, isolated synthetic user. No employer or local profile writes.
const fixture=await adminFixture();
const bundle=await build({stdin:{contents:"import {createRoot} from 'react-dom/client'; import {AdminDashboard} from './apps/web/src/AdminDashboard.tsx'; createRoot(document.getElementById('root')).render(<AdminDashboard/>);",resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outfile:"admin-test.js",format:"iife",platform:"browser",jsx:"automatic",define:{"import.meta.env":JSON.stringify({VITE_API_URL:"https://admin.example.test"}),"process.env.NODE_ENV":'"production"'}});
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:980}}),errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=="https://admin.example.test")return route.abort();
    if(url.pathname.startsWith("/v1/")) {
      const result=await fixture.app.inject({method:route.request().method() as "GET"|"POST",url:url.pathname+url.search,headers:route.request().headers(),...(route.request().postData()?{payload:route.request().postData()!}:{})});
      return route.fulfill({status:result.statusCode,contentType:"application/json",body:result.body});
    }
    return route.fulfill({contentType:"text/html",body:"<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'/></head><body style='margin:0'><div id='root'></div></body></html>"});
  });
  await page.goto("https://admin.example.test/#admin");
  await page.addStyleTag({path:"apps/web/src/styles.css"});
  await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith(".css"))!.text});
  await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith(".js"))!.text});
  await page.getByLabel("Email",{exact:true}).fill("admin@example.test");
  await page.getByLabel("Password",{exact:true}).fill("incorrect");
  await page.getByRole("button",{name:"Open admin workspace"}).click();
  await page.getByRole("alert").filter({hasText:"Email or password does not match"}).waitFor();
  await page.getByLabel("Password",{exact:true}).fill("synthetic-admin-password");
  await page.getByRole("button",{name:"Open admin workspace"}).click();
  await page.getByRole("heading",{name:"Overview",exact:true}).waitFor();
  await page.locator(".adm-metrics article").first().waitFor();
  // Revoke the active session server-side, as happens after an API restart.
  await page.route("**/v1/admin/overview",async route=>{
    await fixture.app.inject({method:"POST",url:"/v1/admin/logout",headers:route.request().headers()});
    const result=await fixture.app.inject({url:"/v1/admin/overview",headers:route.request().headers()});
    await route.fulfill({status:result.statusCode,contentType:"application/json",body:result.body});
  },{times:1});
  await page.getByRole("button",{name:"Refresh",exact:false}).click();
  await page.getByRole("alert").filter({hasText:"session expired"}).waitFor();
  assert.ok(await page.getByRole("button",{name:"Open admin workspace"}).isEnabled(),"expired session must not leave login stuck busy");
  await page.getByLabel("Email",{exact:true}).fill("admin@example.test");
  await page.getByLabel("Password",{exact:true}).fill("synthetic-admin-password");
  await page.getByRole("button",{name:"Open admin workspace"}).click();
  await page.locator(".adm-metrics article").first().waitFor();
  await mkdir(".local-data/qa",{recursive:true});
  await page.screenshot({path:".local-data/qa/admin-overview.png",fullPage:true});
  const navigate=async(name:string)=>{await page.getByRole("navigation",{name:"Admin sections"}).getByRole("button",{name,exact:false}).click();};
  await navigate("People & knowledge");
  await page.getByRole("button",{name:"Inspect record 1",exact:true}).click();
  await page.getByRole("heading",{name:"Candidate knowledge graph"}).waitFor();
  await page.getByRole("button",{name:"Add answer"}).click();
  let dialog=page.getByRole("dialog");
  const payload=JSON.parse(await dialog.getByLabel("Validated change payload").inputValue());payload.items[0].normalizedValue.value="Gurugram";
  await dialog.getByLabel("Validated change payload").fill(JSON.stringify(payload));
  await dialog.getByLabel("Reason for this change").fill("Candidate confirmed current location in this isolated test.");
  await dialog.getByRole("button",{name:"Validate & save"}).click();
  await page.getByRole("dialog").waitFor({state:"hidden"});
  await page.locator(".adm-answer-grid").getByText("Gurugram",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Revise answer"}).first().click();
  dialog=page.getByRole("dialog");
  const revised=JSON.parse(await dialog.getByLabel("Validated change payload").inputValue());revised.items[0].normalizedValue.value="Delhi";
  await dialog.getByLabel("Validated change payload").fill(JSON.stringify(revised));
  await dialog.getByLabel("Reason for this change").fill("Candidate confirmed a changed location for version testing.");
  await dialog.getByRole("button",{name:"Validate & save"}).click();
  await page.getByRole("dialog").waitFor({state:"hidden"});
  await page.locator(".adm-answer-grid").getByText("Delhi",{exact:true}).waitFor();
  await page.getByText("Version history (latest 100) & entity nodes",{exact:true}).click();
  await page.getByRole("button",{name:"Restore as a new version"}).first().click();
  await page.getByRole("dialog").getByLabel("Reason for this change").fill("Restore earlier verified location in synthetic test.");
  await page.getByRole("dialog").getByRole("button",{name:"Validate & save"}).click();
  await page.getByRole("dialog").waitFor({state:"hidden"});
  await page.locator(".adm-answer-grid").getByText("Gurugram",{exact:true}).waitFor();
  await page.screenshot({path:".local-data/qa/admin-knowledge.png",fullPage:true});
  await navigate("Representation lab");await page.getByLabel("Search registry").fill("CURRENT_CTC");
  await page.getByRole("button",{name:"Preview output"}).click();
  await page.getByRole("button",{name:"Run preview"}).click();
  await page.getByRole("dialog").locator("pre").filter({hasText:"1400000"}).waitFor();
  await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
  await page.getByRole("button",{name:"Edit defaults"}).click();
  dialog=page.getByRole("dialog");const rep=JSON.parse(await dialog.getByLabel("Validated change payload").inputValue());rep.value.moneyScale="LAKHS";
  await dialog.getByLabel("Validated change payload").fill(JSON.stringify(rep));await dialog.getByLabel("Reason for this change").fill("Test compensation display in lakhs for unitless fields.");
  await dialog.getByRole("button",{name:"Validate & save"}).click();await page.getByRole("dialog").waitFor({state:"hidden"});
  await page.getByRole("button",{name:"Preview output"}).click();await page.getByRole("button",{name:"Run preview"}).click();
  await page.getByRole("dialog").locator("pre").filter({hasText:'"text": "14"'}).waitFor();
  await page.screenshot({path:".local-data/qa/admin-representation-preview.png",fullPage:true});
  await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
  await navigate("Canonical registry");await page.getByLabel("Search registry").fill("EMAIL");
  await page.getByRole("button",{name:"Edit aliases & description"}).click();
  dialog=page.getByRole("dialog");const canonical=JSON.parse(await dialog.getByLabel("Validated change payload").inputValue());
  await fixture.workspace.saveConfig({...canonical,reason:"Concurrent edit from another admin session."});
  await dialog.getByLabel("Reason for this change").fill("Trying a stale edit to verify conflict handling.");await dialog.getByRole("button",{name:"Validate & save"}).click();
  await dialog.getByRole("alert").filter({hasText:"changed"}).waitFor();await dialog.getByRole("button",{name:"Cancel"}).click();
  for(const name of ["Canonical proposals","Strategy control","Applications","Application runs","Field execution","Learning observations","Failure review","AI health & usage","Job catalog","Documents","Background jobs","Audit trail"]) {
    await navigate(name);await page.getByRole("button",{name:"Refresh",exact:false}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('[role="status"]')?.textContent?.includes("Loading"));
    assert.equal(await page.getByRole("alert").count(),0,`${name} must load without API errors`);
  }
  await page.setViewportSize({width:390,height:844});await navigate("Overview");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"mobile admin layout does not overflow");
  await page.screenshot({path:".local-data/qa/admin-mobile.png",fullPage:true});
  await page.setViewportSize({width:1440,height:980});
  await page.getByRole("button",{name:"Sign out",exact:true}).click();await page.getByRole("heading",{name:"Welcome back."}).waitFor();
  assert.deepEqual(errors,[]);console.log("PASS admin browser: login, incorrect password, every section, profile creation/revision/restoration, runtime preview/edit, stale conflict, desktop/mobile and logout.");
}finally{await browser.close();await fixture.close();}
