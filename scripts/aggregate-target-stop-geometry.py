from __future__ import annotations
import json, sys
from pathlib import Path

src = Path(sys.argv[1] if len(sys.argv) > 1 else 'geometry-results')
out = Path(sys.argv[2] if len(sys.argv) > 2 else 'target-stop-geometry-summary.json')
rows=[]
for p in src.glob('*.json'):
    d=json.loads(p.read_text())
    for result in d.get('results',[]):
        rows.extend(result.get('geometryEpisodes',[]))

def q(vals,p):
    vals=sorted(v for v in vals if isinstance(v,(int,float)))
    if not vals:return None
    i=(len(vals)-1)*p
    lo=int(i); hi=min(lo+1,len(vals)-1); f=i-lo
    return round(vals[lo]*(1-f)+vals[hi]*f,4)

def summarize(items):
    rrs=[x.get('rr') for x in items]
    risks=[x.get('riskPct') for x in items]
    rewards=[x.get('rewardPct') for x in items]
    blocked=[x for x in items if x.get('rrBlocked')]
    return {
      'episodes':len(items),'rrBlocked':len(blocked),'rrBlockedPct':round(len(blocked)/max(1,len(items))*100,2),
      'rrP25':q(rrs,.25),'rrMedian':q(rrs,.5),'rrP75':q(rrs,.75),
      'riskPctMedian':q(risks,.5),'rewardPctMedian':q(rewards,.5),
      'blockedStopScaleFor18Median':q([x.get('stopScaleFor18') for x in blocked],.5),
      'blockedTargetScaleFor18Median':q([x.get('targetScaleFor18') for x in blocked],.5),
      'rrBins':{
        'lt1_2':sum((x.get('rr') or 0)<1.2 for x in items),
        '1_2_to_1_4':sum(1.2<=(x.get('rr') or 0)<1.4 for x in items),
        '1_4_to_1_6':sum(1.4<=(x.get('rr') or 0)<1.6 for x in items),
        '1_6_to_1_8':sum(1.6<=(x.get('rr') or 0)<1.8 for x in items),
        'ge1_8':sum((x.get('rr') or 0)>=1.8 for x in items),
      }
    }

groups={}
for x in rows:
    key='|'.join(str(x.get(k) or 'none') for k in ('setupModel','zoneSource','reactionType'))
    groups.setdefault(key,[]).append(x)
report={'version':'SMOKE_V5_TARGET_STOP_GEOMETRY_AUDIT_V1','overall':summarize(rows),'groups':{k:summarize(v) for k,v in sorted(groups.items())},'episodes':rows}
out.write_text(json.dumps(report,indent=2))
print(json.dumps({'overall':report['overall'],'groupCount':len(groups)}))
