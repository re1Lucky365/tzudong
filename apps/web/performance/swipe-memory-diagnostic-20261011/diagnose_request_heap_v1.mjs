// Separate diagnostic: request-shape and retained structure, not a performance gate.
// The original heap failure and memory guard remain unchanged.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const evidenceRoot=process.argv[2],output=process.argv[3];
assert.ok(evidenceRoot&&output,'diagnostic input and new output directory required');
const base=pathToFileURL(evidenceRoot.replace(/\/$/,'')+'/');
const {chromium,serve,pageSetup,origin,catalog}=await import(new URL('real-sdk-runtime-v6.mjs',base));
const {snapshotStructure}=await import(new URL('minimize-heap-v2.mjs',base));
const receipts=JSON.parse(await readFile(new URL('build-receipts-v2.json',base)));
const receipt=receipts.find(r=>r.kind==='candidate');
assert.equal(process.versions.node,'24.21.0');
assert.equal(JSON.parse(await readFile(receipt.root+'/node_modules/next/package.json')).version,'16.3.6');
assert.equal((await readFile(receipt.root+'/'+receipt.distDir+'/BUILD_ID','utf8')).trim(),receipt.buildId);
await mkdir(output);
const result={schemaVersion:1,startedAtUtc:new Date().toISOString(),receipt,
  scope:'one fresh candidate process; diagnostic observers and post-idle heap snapshot; no A/B or guard admission',
  sourceRuntime:new URL('real-sdk-runtime-v6.mjs',base).pathname,
  runtimeSourceSha256:createHash('sha256').update(await readFile(new URL('real-sdk-runtime-v6.mjs',base))).digest('hex'),
  environment:{node:process.versions.node,next:'16.3.6',cpuRate:4,viewport:'390x844/dpr1/touch emulation',
    data:'REST735/Auth401 synthetic',SDK:'real remote Naver',cache:'disabled/SW bypassed',network:'unthrottled'},
  performanceAdmission:0,fieldAdmission:0,physicalDevice:false,requestShapes:{},stages:[]};
let server,browser,t;const pending=new Set();
try {
  server=await serve(receipt);browser=await chromium.launch({channel:'chrome',headless:true});result.browser=browser.version();
  t=await pageSetup(browser);await t.cdp.send('Performance.enable');
  t.page.on('response',response=>{
    const url=new URL(response.url());if(!url.pathname.endsWith('/rest/v1/restaurants'))return;
    const fields=['id','approved_name','name','status','lat','lng','categories','review_count','weekly_search_count','or'];
    const names=fields.filter(field=>url.searchParams.has(field));
    const select=url.searchParams.get('select')??'*';
    const selectShape=/^[a-z_,:*()]+$/i.test(select)&&select.length<200?select:'other-select';
    const shape=JSON.stringify({method:response.request().method(),select:selectShape,filters:names,
      ordered:url.searchParams.has('order'),limited:url.searchParams.has('limit'),offset:url.searchParams.has('offset')});
    const item=result.requestShapes[shape]??={requests:0,bytes:0,rows:0,decodeFailures:0};item.requests++;
    const task=response.body().then(body=>{item.bytes+=body.length;try{const rows=JSON.parse(body);if(Array.isArray(rows))item.rows+=rows.length;}catch{item.decodeFailures++;}})
      .catch(()=>{item.decodeFailures++;}).finally(()=>pending.delete(task));pending.add(task);
  });
  await t.page.goto(origin+'/?__qa=swipe-memory-diagnostic-20261011',{waitUntil:'domcontentloaded',timeout:30000});
  await t.page.locator('.cluster-marker-container').filter({hasText:'735'}).waitFor({state:'visible',timeout:45000});
  await t.awaitSdkReceipt();result.sdkScript={...t.sdkScript};
  assert.equal(result.sdkScript.sha256,'802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1');
  const capture=async label=>result.stages.push({label,naturalHeap:await t.cdp.send('Runtime.getHeapUsage'),
    resources:(await t.cdp.send('Performance.getMetrics')).metrics.filter(m=>['Nodes','Documents','JSEventListeners'].includes(m.name))});
  await capture('initial');const fixture=catalog();let completed=0;
  for(let pass=0;pass<2;pass++)for(let query=0;query<128;query++){
    const restaurant=fixture[(query*37+1)%fixture.length];
    await t.page.getByLabel('맛집 검색 열기',{exact:true}).click();
    await t.page.getByLabel('맛집 검색어 입력',{exact:true}).fill(restaurant.name);
    await t.page.getByRole('button',{name:new RegExp(restaurant.name)}).first().click();
    await t.page.getByTestId('restaurant-detail-panel').filter({hasText:restaurant.name}).waitFor({state:'visible',timeout:15000});
    const matched=await t.page.evaluate(({id,name})=>{
      const panel=document.querySelector('[data-testid="restaurant-detail-panel"]');
      const ids=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]'),el=>el.dataset.restaurantId);
      const probe=window.__swipeCacheUiProbe;
      probe.frames.length=0;probe.tasks.length=0;probe.shifts.length=0;
      return !!panel?.textContent?.includes(name)&&ids.includes(id)&&ids.length===new Set(ids).size&&probe.mapCreates===1;
    },{id:restaurant.id,name:restaurant.name});
    assert.ok(matched);completed++;
    if(query===63||query===127){await capture(`pass${pass}-queries${query+1}`);console.log(JSON.stringify({completed}));}
  }
  result.completedActions=completed;await t.page.evaluate(()=>{window.__swipeCacheUiProbe.on=false;});
  await t.page.waitForTimeout(5000);await capture('idle5s');await Promise.allSettled([...pending]);
  result.retainedStructureDiagnostic=await snapshotStructure(t.cdp);
  result.passed=true;
}catch{result.passed=false;result.failureCode='DIAGNOSTIC_PRECONDITION_OR_FLOW_FAILED';}
finally{
  if(t){result.errors={...t.errors};result.requests={...t.requests};await t.close();}
  if(browser)await browser.close();if(server)await server.close();
}
result.endedAtUtc=new Date().toISOString();
await writeFile(output+'/diagnostic-v1.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:result.passed,actions:result.completedActions??0,shapes:Object.keys(result.requestShapes).length,
  retained:result.retainedStructureDiagnostic??null,errors:result.errors??null}));
if(!result.passed)process.exitCode=1;
