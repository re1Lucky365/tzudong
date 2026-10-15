// Real production React page, synthetic Auth/REST only, no operating mutation.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';
import { chromium, expect } from '@playwright/test';
const root = new URL('../../', import.meta.url).pathname;
const output = new URL('./browser-upload-recovery-v3.json', import.meta.url);
const origin = 'http://localhost:3456', distDir = '.next-media-followup-v1';
const owner = '11111111-1111-4111-8111-111111111111';
const review = '22222222-2222-4222-8222-222222222222';
const operation = '77777777-7777-4777-8777-777777777777';
const intent = { operationId: operation, ownerId: owner, reviewId: review, paths: [`${owner}/reviews/${review}/food/${operation}_0.webp`] };
const key = `tzudong:review-upload-intent:v1:${owner}:${operation}`;
const env = parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
const publicEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SITE_URL'].filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));
publicEnv.NEXT_PUBLIC_SITE_URL = 'https://www.tzudong.app';
const result = { sourceHead: execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), sourceScriptSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
  node:process.version, startedAtUtc:new Date().toISOString(), distDir, productionBuild:true, syntheticAuthAndRest:true,
  operatingWrites:0, physicalDevice:false, fieldAdmission:0, pageErrors:0, consoleErrors:0, unsupportedFixture:0, cases:[], passed:false };
let server, browser, lastPage;
try {
  if (existsSync(output) || !process.version.startsWith('v24.')) throw Error('OUTPUT_OR_RUNTIME_DENIED');
  let occupied=false;try{occupied=!!execFileSync('lsof',['-tiTCP:3456','-sTCP:LISTEN'],{stdio:['ignore','pipe','ignore']}).length;}catch{}
  if(occupied)throw Error('OWNED_PORT_UNAVAILABLE');
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3456'],{cwd:root,env:{...process.env,...publicEnv,NODE_ENV:'production',TZUDONG_NEXT_DIST_DIR:distDir},stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}if(i===99||server.exitCode!==null)throw Error('SERVER_UNAVAILABLE');await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});result.browser=await browser.version();
  for(const viewport of [{width:390,height:844},{width:820,height:1180},{width:1440,height:900}]){
    const context=await browser.newContext({viewport,isMobile:viewport.width<1024,hasTouch:viewport.width<1024,serviceWorkers:'block',locale:'ko-KR'});
    const page=await context.newPage();lastPage=page;let queued=0;const names=[];result.rpcNames??=[];result.authFixtureCalls??=0;
    page.on('pageerror',()=>result.pageErrors++);page.on('console',m=>{if(m.type()==='error')result.consoleErrors++;});
    const user={id:owner,aud:'authenticated',role:'authenticated',email:'recovery@fixture.invalid',app_metadata:{provider:'email'},user_metadata:{nickname:'Fixture'}};
    const session={access_token:'fixture-only',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'fixture-only',user};
    await context.addCookies([{name:`sb-${new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`,value:`base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`,domain:'localhost',path:'/',httpOnly:false,secure:false,sameSite:'Lax'}]);
    await page.addInitScript(({key,intent})=>{if(localStorage.getItem('fixture-seeded')===null){localStorage.setItem(key,JSON.stringify(intent));localStorage.setItem('fixture-seeded','1');}},{key,intent});
    await page.route('**/auth/v1/**',r=>{result.authFixtureCalls++;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)});});
    await page.route('https://localhost:3456/**',async route=>{const url=new URL(route.request().url());url.protocol='http:';if(route.request().method()!=='GET')return route.abort();const reply=await fetch(url),headers=Object.fromEntries(reply.headers);delete headers['content-encoding'];delete headers['content-length'];return route.fulfill({status:reply.status,headers,body:Buffer.from(await reply.arrayBuffer())});});
    await page.route('**/rest/v1/**',async route=>{
      const name=new URL(route.request().url()).pathname.split('/').pop();names.push(name);result.rpcNames=[...new Set([...result.rpcNames,name])].sort();let data=[];
      if(name==='get_current_privacy_eligibility')data={schemaVersion:1,eligible:true,reasonCode:'PRIVACY_ELIGIBLE',policyVersionId:owner,policyVersion:'2026-08-04.1',contentSha256:'6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b'};
      else if(name==='read_public_profile_summaries')data=[{user_id:owner,nickname:'Fixture',avatar_url:null}];
      else if(name==='user_roles')data=null;
      else if(name==='read_review_media_commit')data='REVIEW_NOT_CONFIRMED';
      else if(name==='queue_review_upload_cleanup'){queued++;data='REVIEW_CLEANUP_QUEUED';}
      else if(name==='finish_review_media_cleanup')data=0;
      else if(!['reviews','restaurants','pending_review_media_cleanup','bookmarks','notifications'].includes(name)){result.unsupportedFixture++;return route.fulfill({status:400,contentType:'application/json',body:'{}'});}
      return route.fulfill({status:200,contentType:'application/json',headers:{'content-range':'*/0'},body:JSON.stringify(data)});
    });
    await page.route('**/_vercel/**',r=>r.abort());
    await page.goto(origin+'/mypage/reviews',{waitUntil:'domcontentloaded'});
    const retry=page.getByRole('button',{name:'사진 정리 다시 시도',exact:true});
    await expect(retry).toBeVisible({timeout:30000});expect(queued).toBe(0);
    result.cases.push({viewport,case:'automatic revisit preserves interrupted upload',passed:true});
    await retry.click();await expect(page.getByRole('alertdialog')).toBeVisible();await page.getByRole('button',{name:'돌아가기',exact:true}).click();expect(queued).toBe(0);
    result.cases.push({viewport,case:'dismissal never queues cancellation',passed:true});
    await page.reload({waitUntil:'domcontentloaded'});await expect(retry).toBeVisible({timeout:30000});expect(queued).toBe(0);
    expect(await page.evaluate(key=>localStorage.getItem(key)!==null,key)).toBe(true);
    result.cases.push({viewport,case:'reload retains canonical identifier intent',passed:true});
    await retry.click();await page.getByRole('button',{name:'사진 정리',exact:true}).click();
    await expect.poll(()=>queued).toBe(1);await expect(retry).toHaveCount(0);
    expect(await page.evaluate(key=>localStorage.getItem(key)===null,key)).toBe(true);
    result.cases.push({viewport,case:'explicit recovery retires then clears local intent',passed:true});
    await page.screenshot({path:new URL(`./recovery-${viewport.width}-v3.png`,import.meta.url).pathname});
    result.rpcNames=[...new Set([...(result.rpcNames??[]),...names])].sort();await context.close();
  }
  if(result.pageErrors||result.unsupportedFixture)throw Error('BROWSER_ADMISSION_FAILED');result.passed=true;
}catch(error){result.failureCode=/^[A-Z_]+$/.test(error.message)?error.message:'BROWSER_ASSERTION_FAILED';process.exitCode=1;result.assertionKind=error.name;if(lastPage){result.lastPath=new URL(lastPage.url()).pathname;result.visibleLoginButtons=await lastPage.getByRole('button',{name:/로그인/}).count();result.visibleRetryButtons=await lastPage.getByRole('button',{name:/사진 정리/}).count();await lastPage.screenshot({path:new URL('./recovery-failed-v3.png',import.meta.url).pathname});}}
finally{if(browser)await browser.close();if(server)server.kill('SIGTERM');writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:result.passed,cases:result.cases.length,pageErrors:result.pageErrors,consoleErrors:result.consoleErrors,unsupportedFixture:result.unsupportedFixture,failureCode:result.failureCode,operatingWrites:0}));}
