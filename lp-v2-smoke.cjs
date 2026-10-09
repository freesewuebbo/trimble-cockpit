const {chromium}=require("playwright-core");
const fs=require("fs");
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:"/usr/bin/google-chrome",args:["--no-sandbox","--enable-webgl","--use-gl=swiftshader","--disable-dev-shm-usage"]});
 const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
 const errors=[];
 page.on("pageerror",e=>errors.push("pageerror: "+e.message));
 page.on("console",m=>{if(m.type()==="error")errors.push("console: "+m.text().slice(0,300))});
 try{
  await page.goto("https://freesewuebbo.github.io/trimble-cockpit/layout-planner-v2.html?build=V2",{waitUntil:"domcontentloaded",timeout:45000});
  console.log("title",await page.title());
  await page.waitForFunction(()=>document.getElementById("modelList").children.length>0,{timeout:120000});
  console.log("status1",await page.locator("#status").innerText());
  console.log("objects",await page.locator("#objectList .item").count());
  await page.locator('[data-draw="box"]').click();
  const rect=await page.locator("#canvas").boundingBox();
  if(!rect)throw Error("Canvas not visible");
  await page.mouse.click(rect.x+rect.width*.45,rect.y+rect.height*.53);
  await page.mouse.click(rect.x+rect.width*.62,rect.y+rect.height*.65);
  const drawCount=await page.locator("#objectList .item").count();
  console.log("objectList count after drawing",drawCount);
  await page.locator("#exportBtn").click();
  await page.waitForTimeout(4000);
  console.log("exportStatus",await page.locator("#exportResult").innerText());
  await page.screenshot({path:"/tmp/lp-v2-smoke.png",fullPage:true});
  const exportText=await page.locator("#exportResult").innerText();
  if(!exportText||exportText.includes("FEHLER"))throw Error("IFC export failed: "+exportText);
  if(!exportText.includes("Ergänzung")&&!exportText.includes("Ergaenzungen"))throw Error("Supplement IFC not generated");
  if(errors.some(x=>x.includes("pageerror")))throw Error(errors.join(" | "));
  console.log("SMOKE PASS");
 }catch(e){
  console.error("SMOKE FAIL",e.stack||e);
  console.error("status",await page.locator("#status").innerText().catch(()=>"not available"));
  console.error("errors",errors.join(" | "));
  await page.screenshot({path:"/tmp/lp-v2-failed.png",fullPage:true}).catch(()=>{});
  process.exitCode=1;
 }finally{await browser.close()}
})();
