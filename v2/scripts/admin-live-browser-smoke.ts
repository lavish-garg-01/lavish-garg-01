import assert from "node:assert/strict";
import { chromium } from "playwright";

// Read-only live check. Credentials come from server .env, never from client build variables.
if(!process.env.ADMIN_EMAIL||!process.env.ADMIN_PASSWORD)throw new Error("Configure ADMIN_EMAIL and ADMIN_PASSWORD first.");
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:980}}),errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:3000/#admin");
  await page.getByLabel("Email",{exact:true}).fill(process.env.ADMIN_EMAIL);
  await page.getByLabel("Password",{exact:true}).fill(process.env.ADMIN_PASSWORD);
  await page.getByRole("button",{name:"Open admin workspace"}).click();
  await page.getByRole("heading",{name:"Overview",exact:true}).waitFor();
  await page.locator(".adm-metrics strong").first().waitFor();
  assert.equal(await page.getByRole("alert").count(),0);
  for(const name of ["People & knowledge","Canonical registry","Strategy control","AI health & usage"]){
    await page.getByRole("navigation",{name:"Admin sections"}).getByRole("button",{name}).click();
    await page.waitForFunction(()=>!document.querySelector('[role="status"]')?.textContent?.includes("Loading"));
    assert.equal(await page.getByRole("alert").count(),0,`${name} failed`);
  }
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await page.getByRole("heading",{name:"Welcome back."}).waitFor();assert.deepEqual(errors,[]);
  console.log("PASS live localhost admin: real login, overview, users, registry, strategies, AI and logout; no candidate data changed.");
}finally{await browser.close();}
