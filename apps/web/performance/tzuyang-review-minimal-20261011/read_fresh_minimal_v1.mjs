// One bounded read-only census preflight; no SQL, media or auth mutation.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {createClient} from '@supabase/supabase-js';
const privateRoot='/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009';
const sha=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const raw=readFileSync(privateRoot+'/minimal-review-plan-v1.json');
if(sha(raw)!=='d0f1df7d8eda50f3145f0adb489aae39544bb2381ce5a43fb9b05455bba036ea')throw Error('MINIMAL_PLAN_DRIFT');
const plan=JSON.parse(raw),output=new URL('./fresh-minimal-preflight-v1.json',import.meta.url);
if(existsSync(output)||plan.rows.length!==23||plan.operatingWrites!==0)throw Error('MINIMAL_OUTPUT_OR_COVERAGE_DRIFT');
const env=parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
if(env.NEXT_PUBLIC_SUPABASE_URL!=='https://aqlcofblfxdrjhhdmarw.supabase.co'||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('MINIMAL_PROJECT_DENIED');
const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(30000)})}});
try{
 const reply=await client.from('restaurants').select('id,origin_name,approved_name,channel_name,status,youtube_link,youtube_meta,tzuyang_review,updated_at,updated_by_admin_id').in('id',plan.rows.map(x=>x.id)).limit(25);
 if(reply.error||!Array.isArray(reply.data)||reply.data.length!==23)throw Error('MINIMAL_FRESH_COVERAGE_DENIED');
 const rows=new Map(reply.data.map(x=>[x.id,x]));
 const observations=plan.rows.map(old=>{const row=rows.get(old.id);if(!row)throw Error('MINIMAL_FRESH_TARGET_MISSING');return{key:old.key,exactPreimageUnchanged:row.status==='approved'&&row.channel_name==='tzuyang'&&row.updated_by_admin_id===null&&row.updated_at===old.updatedAt&&sha(row.tzuyang_review??'')===old.beforeSha256&&sha(row)===old.recordSha256,currentReviewSha256:sha(row.tzuyang_review??''),currentRecordSha256:sha(row),currentAdminLocked:row.updated_by_admin_id!==null};});
 const result={observedAtUtc:new Date().toISOString(),requests:1,records:23,unchanged:observations.filter(x=>x.exactPreimageUnchanged).length,changed:observations.filter(x=>!x.exactPreimageUnchanged).length,privatePlanSha256:sha(raw),operatingWrites:0,freshReadIsNotTransactionalApproval:true,observations};
 writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({records:result.records,unchanged:result.unchanged,changed:result.changed,requests:1,operatingWrites:0}));
}catch(error){console.log(JSON.stringify({failureCode:/^[A-Z_]+$/.test(error.message)?error.message:'MINIMAL_FRESH_UNCONFIRMED',operatingWrites:0}));process.exitCode=1;}
