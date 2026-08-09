from __future__ import annotations

import json
import math
import sys
from pathlib import Path

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else 'target-selection-results')
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else 'target-selection-summary.json')


def pct(n: int, d: int) -> float:
    return round(n / d * 100, 2) if d else 0.0


def bucket(rr: float | None) -> str:
    if rr is None or not math.isfinite(rr):
        return 'na'
    if rr < 1.2:
        return '<1.2'
    if rr < 1.4:
        return '1.2-1.4'
    if rr < 1.6:
        return '1.4-1.6'
    if rr < 1.8:
        return '1.6-1.8'
    return '>=1.8'

rows = []
for p in sorted(SRC.glob('*.json')):
    d = json.loads(p.read_text())
    symbol_results = d.get('results', [])
    for result in symbol_results:
        for e in result.get('targetSelectionEpisodes', []):
            e = dict(e)
            e['_file'] = p.name
            rows.append(e)

blocked = [e for e in rows if e.get('baselineBlocked')]


def first_rescue(e, touch_threshold: int | None):
    for t in e.get('rankedTargets', [])[1:]:
        if (t.get('rr') or 0) < 1.8:
            continue
        if touch_threshold is None:
            return t
        if t.get(f'skippedAllTouchesGe{touch_threshold}'):
            return t
    return None

summary = {
    'version': 'SMOKE_V5_TARGET_SELECTION_AUDIT_V1',
    'episodes': len(rows),
    'baselineBlocked': len(blocked),
    'baselineBlockedPct': pct(len(blocked), len(rows)),
    'rescue': {},
    'buckets': {},
    'bySetupModel': {},
    'byZoneSource': {},
}

for label, threshold in [('naive', None), ('touchesGe1', 1), ('touchesGe2', 2), ('touchesGe3', 3)]:
    rescued = [(e, first_rescue(e, threshold)) for e in blocked]
    rescued = [(e, t) for e, t in rescued if t]
    by_rank = {}
    for _, t in rescued:
        r = str(t['rank'])
        by_rank[r] = by_rank.get(r, 0) + 1
    summary['rescue'][label] = {
        'count': len(rescued),
        'pctOfBlocked': pct(len(rescued), len(blocked)),
        'byRank': by_rank,
    }

for b in ['<1.2', '1.2-1.4', '1.4-1.6', '1.6-1.8', '>=1.8', 'na']:
    group = [e for e in rows if bucket(e.get('baselineRR')) == b]
    if not group:
        continue
    item = {'count': len(group)}
    for label, threshold in [('naive', None), ('touchesGe1', 1), ('touchesGe2', 2), ('touchesGe3', 3)]:
        n = sum(1 for e in group if first_rescue(e, threshold))
        item[label] = {'count': n, 'pct': pct(n, len(group))}
    summary['buckets'][b] = item

for field, out_key in [('setupModel', 'bySetupModel'), ('zoneSource', 'byZoneSource')]:
    values = sorted({str(e.get(field)) for e in blocked})
    for value in values:
        group = [e for e in blocked if str(e.get(field)) == value]
        summary[out_key][value] = {
            'blocked': len(group),
            'naive': sum(1 for e in group if first_rescue(e, None)),
            'touchesGe1': sum(1 for e in group if first_rescue(e, 1)),
            'touchesGe2': sum(1 for e in group if first_rescue(e, 2)),
            'touchesGe3': sum(1 for e in group if first_rescue(e, 3)),
        }

examples = []
for e in blocked:
    naive = first_rescue(e, None)
    valid2 = first_rescue(e, 2)
    if naive or valid2:
        examples.append({
            'symbol': e.get('symbol'),
            'time': e.get('time'),
            'setupModel': e.get('setupModel'),
            'zoneSource': e.get('zoneSource'),
            'reactionType': e.get('reactionType'),
            'baselineRR': e.get('baselineRR'),
            'naiveTarget': naive,
            'touchesGe2Target': valid2,
        })
summary['examples'] = examples[:200]

OUT.write_text(json.dumps(summary, indent=2))
print(json.dumps({
    'episodes': summary['episodes'],
    'baselineBlocked': summary['baselineBlocked'],
    'rescue': summary['rescue'],
    'buckets': summary['buckets'],
}))
