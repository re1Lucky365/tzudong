// Real production React page, synthetic Auth/REST only, no operating mutation.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';
import { chromium, expect } from '@playwright/test';
import { fixtureQuery } from '../user-readiness-20261009/fixture-query-v7.mjs';
const root = new URL('../../', import.meta.url).pathname;
const output = new URL('./browser-admin-expiry-v3.json', import.meta.url);
const origin = 'http://localhost:3456', distDir = '.next-media-followup-v4';
const owner = '11111111-1111-4111-8111-111111111111';
const review = '22222222-2222-4222-8222-222222222222';
const operation = '77777777-7777-4777-8777-777777777777';
const intent = { operationId: operation, ownerId: owner, reviewId: review, paths: [`${owner}/reviews/${review}/food/${operation}_0.webp`] };
const key = `tzudong:review-upload-intent:v1:${owner}:${operation}`;
const fixtureJwt=[{alg:'HS256',typ:'JWT'},{sub:owner,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,session_id:'88888888-8888-4888-8888-888888888888'},'fixture-signature'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.');
const env = parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
const publicEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SITE_URL'].filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));
publicEnv.NEXT_PUBLIC_SITE_URL = 'https://www.tzudong.app';
const result = { sourceHead: execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), sourceScriptSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
  node:process.version, startedAtUtc:new Date().toISOString(), distDir, productionBuild:true, syntheticAuthAndRest:true, serverAuthMockedInOwnedProcess:true,
  myPageSourceSha256:createHash('sha256').update(readFileSync(root+'app/mypage/mypage-layout-content.tsx')).digest('hex'), operatingWrites:0, physicalDevice:false, fieldAdmission:0, pageErrors:0, consoleErrors:0, unsupportedFixture:0, cases:[], passed:false };
let server, browser, lastPage;
try {
  if (existsSync(output) || !process.version.startsWith('v24.')) throw Error('OUTPUT_OR_RUNTIME_DENIED');
  let occupied=false;try{occupied=!!execFileSync('lsof',['-tiTCP:3456','-sTCP:LISTEN'],{stdio:['ignore','pipe','ignore']}).length;}catch{}
  if(occupied)throw Error('OWNED_PORT_UNAVAILABLE');
  server=spawn(process.execPath,['--import',new URL('./fixture-server-fetch-v1.mjs',import.meta.url).pathname,'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3456'],{cwd:root,env:{...process.env,...publicEnv,NODE_ENV:'production',TZUDONG_NEXT_DIST_DIR:distDir,TZUDONG_FIXTURE_JWT:fixtureJwt},stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}if(i===99||server.exitCode!==null)throw Error('SERVER_UNAVAILABLE');await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:'chrome',headless:true});result.browser=await browser.version();
  for(const viewport of [{width:390,height:844},{width:820,height:1180},{width:1440,height:900}]){
    const context=await browser.newContext({viewport,isMobile:viewport.width<1024,hasTouch:viewport.width<1024,serviceWorkers:'block',locale:'ko-KR'});
    const page=await context.newPage();lastPage=page;let queued=0,recordGets=0,recordPosts=0,expired=false;const names=[];result.rpcNames??=[];result.authFixtureCalls??=0;
    page.on('pageerror',error=>{result.pageErrors++;const kind=/Supabase browser client requires/.test(error.message)?'PUBLIC_ENV_MISSING':'OTHER_PAGE_ERROR';result.pageErrorKinds??={};result.pageErrorKinds[kind]=(result.pageErrorKinds[kind]??0)+1;result.errorShapes??=[];result.errorShapes.push({reactCode:error.message.match(/Minified React error #([0-9]+)/)?.[1]??null,name:error.name,digest:createHash('sha256').update(error.message).digest('hex'),tokens:['JWT','React','hydration','URL','session','auth','WebSocket','JSON','DOM','not defined','undefined','decode','cookie','localStorage','SecurityError','Access is denied','_next'].filter(x=>error.message.includes(x))});});page.on('console',m=>{if(m.type()!=='error')return;result.consoleErrors++;const kind=/status of 409/.test(m.text())?'expectedExpiry409':/Content Security Policy/i.test(m.text())?'CSP':/ERR_BLOCKED_BY_CLIENT/.test(m.text())?'blockedClient':'unclassified';result.consoleKinds??={};result.consoleKinds[kind]=(result.consoleKinds[kind]??0)+1;if(kind==='unclassified'){result.consoleShapes??=[];result.consoleShapes.push({digest:createHash('sha256').update(m.text()).digest('hex'),tokens:['404','403','400','503','CSP','Naver','NAVER','pstatic','maps','manifest','Failed to load resource','ERR_','SSL','certificate','websocket','WebSocket'].filter(x=>m.text().includes(x))});}});
    const user={id:owner,aud:'authenticated',role:'authenticated',email:'recovery@fixture.invalid',app_metadata:{provider:'email'},user_metadata:{nickname:'Fixture'}};
    const session={access_token:fixtureJwt,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'fixture-only',user};
    await context.addCookies([{name:`sb-${new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`,value:`base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`,domain:'localhost',path:'/',httpOnly:false,secure:false,sameSite:'Lax'}]);
    await page.addInitScript(({key,intent})=>{if(window.top!==window||location.origin!=='http://localhost:3456')return;if(localStorage.getItem('fixture-seeded')===null){localStorage.setItem(key,JSON.stringify(intent));localStorage.setItem('fixture-seeded','1');}},{key,intent});
    await page.route('**/auth/v1/**',r=>{result.authFixtureCalls++;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)});});
    await page.route('https://localhost:3456/**',async route=>{const url=new URL(route.request().url());url.protocol='http:';if(route.request().method()!=='GET')return route.abort();const reply=await fetch(url),headers=Object.fromEntries(reply.headers);delete headers['content-encoding'];delete headers['content-length'];return route.fulfill({status:reply.status,headers,body:Buffer.from(await reply.arrayBuffer())});});
    await page.route('**/rest/v1/**',async route=>{
      const name=new URL(route.request().url()).pathname.split('/').pop();names.push(name);result.rpcNames=[...new Set([...result.rpcNames,name])].sort();let data=[];
      if(name==='get_current_privacy_eligibility')data={schemaVersion:1,eligible:true,reasonCode:'PRIVACY_ELIGIBLE',policyVersionId:owner,policyVersion:'2026-08-04.1',contentSha256:'6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b'};
      else if(name==='read_public_profile_summaries')data=[{user_id:owner,nickname:'Fixture',avatar_url:null}];
      else if(name==='user_roles')data={role:'admin'};
      else if(name==='read_review_media_commit')data='REVIEW_NOT_CONFIRMED';
      else if(name==='queue_review_upload_cleanup'){queued++;data='REVIEW_CLEANUP_QUEUED';}
      else if(name==='finish_review_media_cleanup')data=0;
      else if(name==='restaurants'){const rows=[{id:review,approved_name:'합성 복구 식당',name:'합성 복구 식당',lat:37.5,lng:127,road_address:'서울 합성로',categories:['한식'],status:'approved',created_at:'2026-09-01T00:00:00Z',review_count:0,weekly_search_count:0,youtube_link:null,youtube_meta:null,tzuyang_review:'합성 리뷰'}];const reply=fixtureQuery(rows,new URL(route.request().url()).searchParams);data=reply.data;if(route.request().headers()['accept']?.includes('vnd.pgrst.object'))data=data[0]??null;}
      else if(!['reviews','pending_review_media_cleanup','bookmarks','notifications','get_restaurant_review_stats','restaurant_requests','announcements','user_bookmarks','ad_banners','restaurant_popular_rank_snapshots'].includes(name)){result.unsupportedFixture++;return route.fulfill({status:400,contentType:'application/json',body:'{}'});}
      return route.fulfill({status:200,contentType:'application/json',headers:{'content-range':'*/0'},body:JSON.stringify(data)});
    });
    await page.route('**/_vercel/**',r=>r.abort());
    const binding=createHash('sha256').update(`admin-record-recovery:v2:${owner}`).digest('hex');
    const pendingKey=`admin:record-action-pending:v2:${binding}`;
    const pending={operationId:operation,action:'restaurant.edit',targetIds:[review],previewHash:'a'.repeat(64),cleanupAttempt:false,cleanupDeferred:false,cleanupContinuation:false};
    await page.addInitScript(({pendingKey,pending})=>{sessionStorage.setItem(pendingKey,JSON.stringify(pending));},{pendingKey,pending});
    await page.route('**/api/admin/record-actions**',route=>{
      if(route.request().method()!=='GET'){recordPosts++;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'FIXTURE_NO_APPLY_ALLOWED'})});}
      recordGets++;
      if(expired)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'RECORD_ACTION_PREVIEW_EXPIRED'})});
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,receipt:{...pending,state:'preview',auditId:null,expiresAt:'2000-01-01T00:00:00Z',readback:[{id:review,kind:'restaurant',status:'approved',fingerprint:'b'.repeat(64)}],mediaCleanupPending:false}})});
    });
    await page.goto(`${origin}/?restaurant=${review}&__qa=readiness`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'맛집 정보 관리자 편집',exact:true}).click({timeout:30000});
    const retry=page.getByRole('button',{name:'기존 작업 결과 조회',exact:true});
    await expect(retry).toBeVisible({timeout:30000});
    expect(recordPosts).toBe(0);expect(await page.evaluate(k=>sessionStorage.getItem(k)!==null,pendingKey)).toBe(true);
    result.cases.push({viewport,case:'uncertain preview recovery remains GET-only even after its deadline',passed:true});
    expired=true;await retry.click();
    await expect(page.getByRole('alert').filter({hasText:'확인 시간이 만료되었습니다'})).toBeVisible();
    expect(await page.evaluate(k=>sessionStorage.getItem(k)===null,pendingKey)).toBe(true);expect(recordPosts).toBe(0);
    result.cases.push({viewport,case:'server-confirmed expired unapplied operation clears matching pending identity',passed:true});
    await page.getByRole('button',{name:'닫기',exact:true}).click();await expect(retry).toHaveCount(0);
    result.cases.push({viewport,case:'terminal operation can close without replaying Apply',passed:true,recordGets,recordPosts});
    await page.screenshot({path:new URL(`./admin-expiry-${viewport.width}-v3.png`,import.meta.url).pathname});
    result.rpcNames=[...new Set([...(result.rpcNames??[]),...names])].sort();await context.close();
  }
  result.functionalFlowsPassed=result.cases.length===9&&!result.pageErrors&&!result.unsupportedFixture;result.browserHealthClean=!result.pageErrors&&result.consoleErrors===(result.consoleKinds?.expectedExpiry409??0);if(!result.functionalFlowsPassed)throw Error('BROWSER_ADMISSION_FAILED');result.passed=true;
}catch(error){result.failureCode=/^[A-Z_]+$/.test(error.message)?error.message:'BROWSER_ASSERTION_FAILED';process.exitCode=1;result.assertionKind=error.name;if(lastPage&&!lastPage.isClosed()){result.lastPath=new URL(lastPage.url()).pathname;result.visibleLoginButtons=await lastPage.getByRole('button',{name:/로그인/}).count();result.visibleRetryButtons=await lastPage.getByRole('button',{name:/사진 정리/}).count();await lastPage.screenshot({path:new URL('./admin-expiry-failed-v3.png',import.meta.url).pathname});}}
finally{if(browser)await browser.close();if(server)server.kill('SIGTERM');writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:result.passed,cases:result.cases.length,pageErrors:result.pageErrors,consoleErrors:result.consoleErrors,unsupportedFixture:result.unsupportedFixture,failureCode:result.failureCode,operatingWrites:0}));}
