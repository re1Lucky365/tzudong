import datetime, hashlib, json, pathlib, shutil, subprocess
root = pathlib.Path(__file__).resolve().parent
repo = root.parents[3]
app = repo / 'apps/web'
canonical = root / 'canonical-zero-v3'
canonical.mkdir()
source = pathlib.Path('/Users/twoimo/.codex/worktrees/ranking-page-headers-20261008/tzudong/apps/web/performance/swipe-selection-cache-20261009/canonical-zero-v1')
shutil.copytree(source / 'contracts', canonical / 'contracts')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(name, data):
    p=canonical/name
    with p.open('x') as f: json.dump(data,f,ensure_ascii=False,sort_keys=True,separators=(',',':'));f.write('\n')
def utc(value): return datetime.datetime.fromisoformat(value.replace('Z','+00:00')).isoformat(timespec='microseconds').replace('+00:00','Z')
candidate={'sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'tree':subprocess.check_output(['git','rev-parse','HEAD^{tree}'],cwd=repo,text=True).strip()}
runs=[json.loads((root/f'after-{i}.json').read_text()) for i in range(4)]
binding={'candidate':candidate,'releaseId':'transitions-adoption-20261012','configSha256':sha(root/'plan-v1.json'),'dataProfileSha256':runs[0]['fixtureSha256']}
old=json.loads((source/'health.json').read_text())
coverage=[{**x,'count':0} for x in old['coverage']]
incidents=[]
for i,run in enumerate(runs):
    for key,count in run['consoleErrors'].items():
        for j in range(count): incidents.append({'id':f'after-{i}-{key.lower()}-{j}','gate':'required_cell_console_page_network_errors','capturedAt':utc(run['endedUtc'])})
for row in coverage:
    if row['gate']=='required_cell_console_page_network_errors':row['count']=len(incidents)
incidents.sort(key=lambda x: x['id'])
health={**binding,'schemaVersion':'performance-health-source.v1','coverage':coverage,'incidents':incidents,'window':{'start':utc(min(r['startedUtc'] for r in runs)),'end':utc(max(r['endedUtc'] for r in runs))}}
save('health.json',health)
frozen=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='microseconds').replace('+00:00','Z')
raw={**binding,'schemaVersion':'performance-backlog-raw.v2','frozenAsOf':frozen,'healthReceipt':{'path':'health.json','sha256':sha(canonical/'health.json')},'items':[]}
save('backlog.raw.json',raw)
oldmap=json.loads((source/'score-artifact-map.json').read_text())
for pin in oldmap['pins'].values():assert sha(canonical/pin['path'])==pin['sha256']
scoremap={**binding,'schemaVersion':'performance-trusted-artifacts.v1','frozenAsOf':frozen,'pins':oldmap['pins'],'artifacts':{n:sha(canonical/n) for n in ['backlog.raw.json','health.json']}}
save('score-artifact-map.json',scoremap)
common=['--artifact-root',str(canonical),'--release-id',binding['releaseId'],'--candidate-sha',candidate['sha'],'--candidate-tree',candidate['tree'],'--config-sha256',binding['configSha256'],'--data-profile-sha256',binding['dataProfileSha256'],'--frozen-as-of',frozen,'--input','backlog.raw.json']
node='/Users/twoimo/.npm/_npx/387698761821791d/node_modules/node/bin/node'
score=[node,str(app/'scripts/score-performance-backlog.mjs'),*common,'--artifact-map','score-artifact-map.json','--artifact-map-sha256',sha(canonical/'score-artifact-map.json'),'--output','backlog.scored.json']
subprocess.run(score,cwd=app,check=True)
(canonical/'backlog.scored.json.sha256').write_text(sha(canonical/'backlog.scored.json')+'\n')
validmap={**scoremap,'artifacts':{n:sha(canonical/n) for n in ['backlog.raw.json','health.json','backlog.scored.json','backlog.scored.json.sha256']}}
save('validate-artifact-map.json',validmap)
validate=[node,str(app/'scripts/validate-performance-backlog.mjs'),*common,'--artifact-map','validate-artifact-map.json','--artifact-map-sha256',sha(canonical/'validate-artifact-map.json'),'--scored','backlog.scored.json']
subprocess.run(validate,cwd=app,check=True)
save('basis.json',{'commands':[score,validate],'items':0,'performanceAdmissions':0,'consoleIncidents':len(incidents),'physicalDevice':False,'fieldAdmission':0,'remainingGoal':True,'scope':'Four candidate local production browser processes, synthetic REST/Auth. Other gate counts mean observed incidents within this scope only, not deployed/field/security coverage. Timer counts and optical durations are not canonical budget metrics.'})
print(json.dumps({'candidate':candidate,'items':0,'consoleIncidents':len(incidents),'validatorMapSha256':sha(canonical/'validate-artifact-map.json')}))
