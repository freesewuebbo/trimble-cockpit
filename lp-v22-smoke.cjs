const {chromium}=require("playwright-core");
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:"/usr/bin/google-chrome",args:["--no-sandbox","--enable-webgl","--use-gl=swiftshader","--disable-dev-shm-usage"]});
 const page=await browser.newPage({viewport:{width:1600,height:900}});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 try{
  await page.goto("https://freesewuebbo.github.io/trimble-cockpit/layout-planner-v22.html?build=V2.2",{waitUntil:"domcontentloaded",timeout:55000});
  await page.waitForFunction(()=>document.querySelector("#modelList")?.children?.length>0,{timeout:120000});
  console.log("Start:",await page.locator("#status").innerText());
  const elem=page.locator("#objectList .item").filter({hasText:"BAZ 01"}).first();
  if(!(await elem.count()))throw Error("BAZ 01 not found");
  await elem.click();
  page.once("dialog",d=>d.accept());
  await page.locator("#deleteButton").click();
  await page.locator("#exportBtn").click();
  await page.waitForTimeout(2500);
  const report=await page.locator("#exportResult").innerText();
  console.log("EXPORT RESULT:",report);
  if(report.includes("Upload gesperrt")||report.includes("Gesamt-Upload gesperrt"))throw Error("Deletion did not export");
  if(!report.includes("1 gelöscht"))throw Error("Deletion not reported in exported IFC");
  if(!report.includes("_LP_V002_"))throw Error("Expected new IFC variant not offered");
  if(errors.length)throw Error(errors.join(" | "));
  console.log("V2.2 IFC-DELETION ROUNDTRIP PASS");
 }catch(e){
  console.error("V2.2 FAILURE:",e.stack||e);
  console.error("status",await page.locator("#status").innerText().catch(()=>""));
  console.error("browser errors",errors);
  await page.screenshot({path:"/tmp/lp-v22-failure.png",fullPage:true}).catch(()=>{});
  process.exitCode=1;
 }finally{await browser.close()}
})();
