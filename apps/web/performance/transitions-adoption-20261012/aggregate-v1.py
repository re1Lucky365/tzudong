import hashlib,json,pathlib,statistics,subprocess,datetime,re
r=pathlib.Path(__file__).resolve().parent;repo=r.parents[3]
def read(n):return json.loads((r/n).read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
before=[read(f'before-{i}.json') for i in [2,3,4]];after=[read(f'after-{i}.json') for i in range(3)];timer_before=read('before-5.json')
assert all(x['passed'] and x['pageErrors']==0 for x in before+after+[timer_before,read('after-3.json')])
for run in after:
 for c in run['cases']:
  assert all(s['pendingRetirementTimers']==1 for s in c['samples'])
  assert c['toastReduced']['animation']=='none' and c['toastReduced']['transition']=='none'
for c in timer_before['cases']:assert [s['pendingRetirementTimers'] for s in c['samples']]==list(range(1,7))
frames=[f for run in after for c in run['cases'] for s in c['samples'] for f in s['frames']]
gaps=[s['frames'][i]['elapsedMs']-s['frames'][i-1]['elapsedMs'] for run in after for c in run['cases'] for s in c['samples'] for i in range(1,len(s['frames']))]
assert all(f['opacity']>=.9 for f in frames)
log=(r/'full-unit-v1.log').read_text();passes=sum(map(int,re.findall(r'^\s+(\d+) pass$',log,re.M)));failures=sum(map(int,re.findall(r'^\s+(\d+) fail$',log,re.M)));skips=sum(map(int,re.findall(r'^\s+(\d+) skip$',log,re.M)))
css=read('css-comparison-v1.json');delta=css['before']['homeTransferBytes']-css['after']['homeTransferBytes']
summary={'sourceBefore':'10d3ac0b3575d2dcc282381a99e57c3a10ac069c','sourceAfter':read('configured-build-motion-v3.json')['sourceHead'],'browser':after[0]['browser'],'node':after[0]['node'],'processes':{'motionBefore':3,'motionAfter':3,'timerBefore':1,'timerAfter':3,'extraSwipeAfter':1},'dependentShareActionsPerViewportProcess':6,'viewports':[[390,844],[820,1180],[1440,900]],'pendingTimerResult':{'beforeAfter6':6,'afterAfter6':1,'absoluteDecrease':5,'relativeDecreasePercent':100*5/6,'scope':'Pending 1000000ms timers from actual share-success flow, diagnostic count. Not heap/RSS.'},'unit':{'pass':passes,'skip':skips,'fail':failures},'visualObservation':{'attempts':54,'opacityBelowPoint9':0,'frameSamples':len(frames),'medianFrameSampleGapMs':statistics.median(gaps),'limits':'Sampling starts after the toast is visible, approximately one rAF. Does not detect unobserved first frames, sub-frame flicker, SDK pixels, or black rectangles elsewhere. Repeats within process are dependent.'},'cssTransfer':{'before':css['before']['homeTransferBytes'],'after':css['after']['homeTransferBytes'],'absoluteDecrease':delta,'relativeDecreasePercent':100*delta/css['before']['homeTransferBytes']},'consoleIncidentsPerPrimaryProcess':{'before':[sum(x['consoleErrors'].values()) for x in before],'after':[sum(x['consoleErrors'].values()) for x in after]},'performanceAdmission':0,'physicalDevice':False,'fieldAdmission':0,'deployed':False}
with (r/'summary-v1.json').open('x') as f:json.dump(summary,f,ensure_ascii=False,indent=2);f.write('\n')
files=subprocess.check_output(['git','diff','--name-only',summary['sourceBefore'],summary['sourceAfter']],cwd=repo,text=True).splitlines()
manifest={'candidate':summary['sourceAfter'],'files':{p:sha(repo/p) for p in files},'packageLockSha256':sha(repo/'apps/web/package-lock.json'),'fixtureSha256':after[0]['fixtureSha256']}
with (r/'source-manifest-v1.json').open('x') as f:json.dump(manifest,f,indent=2);f.write('\n')
(r/'source.patch').write_bytes(subprocess.check_output(['git','diff',summary['sourceBefore'],summary['sourceAfter']],cwd=repo))
print(json.dumps(summary,ensure_ascii=False))
