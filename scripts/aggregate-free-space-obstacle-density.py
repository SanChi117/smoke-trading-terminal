from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

INPUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'free-space-results')
OUTPUT = Path(sys.argv[2] if len(sys.argv) > 2 else 'free-space-obstacle-density-summary.json')


def rnd(value, digits=4):
    if value is None or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return round(value, digits)


def percentile(values, q):
    xs = sorted(v for v in values if isinstance(v, (int, float)) and math.isfinite(v))
    if not xs:
        return None
    pos = (len(xs) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return xs[lo]
    return xs[lo] * (hi - pos) + xs[hi] * (pos - lo)


def rate(rows):
    return sum(1 for r in rows if r.get('targetPass')) / max(len(rows), 1)


def stats(rows):
    rr = [r.get('productionRr') for r in rows if isinstance(r.get('productionRr'), (int, float))]
    gap = [((r.get('first') or {}).get('zoneGapAtr15')) for r in rows]
    gap = [v for v in gap if isinstance(v, (int, float))]
    return {
        'episodes': len(rows),
        'targetPass': sum(1 for r in rows if r.get('targetPass')),
        'targetPassRatePct': rnd(rate(rows) * 100, 2),
        'rrBlocked': sum(1 for r in rows if r.get('rrBlocked')),
        'medianProductionRr': rnd(percentile(rr, .5)),
        'medianFirstGapAtr15': rnd(percentile(gap, .5)),
        'p25FirstGapAtr15': rnd(percentile(gap, .25)),
        'p75FirstGapAtr15': rnd(percentile(gap, .75)),
    }


def group(rows, key_fn):
    out = defaultdict(list)
    for row in rows:
        out[str(key_fn(row))].append(row)
    return {k: stats(v) for k, v in sorted(out.items(), key=lambda item: item[0])}


files = sorted(INPUT.glob('*.json'))
all_rows = []
window_rows = defaultdict(list)
for path in files:
    payload = json.loads(path.read_text())
    window = path.stem.replace('free-space-', '')
    for result in payload.get('results', []):
        for row in result.get('freeSpaceEpisodes', []):
            item = dict(row)
            item['window'] = window
            all_rows.append(item)
            window_rows[window].append(item)

baseline_rate = rate(all_rows)

# Fixed before looking at results. These use only information already available when the FROM zone exists
# and the pre-existing opposite HTF obstacles are known. Outcome is later production RR viability.
rules = []
for threshold in [2, 3, 4, 5, 6, 8]:
    rules.append((f'firstGapAtr15>={threshold}', lambda r, t=threshold: ((r.get('first') or {}).get('zoneGapAtr15') or -1) >= t))
for threshold in [0.5, 1.0, 1.5, 2.0]:
    rules.append((f'fromWidthAtr15<={threshold}', lambda r, t=threshold: isinstance(r.get('fromWidthAtr15'), (int, float)) and r['fromWidthAtr15'] <= t))
for field, threshold in [('obstaclesWithin2Atr', 0), ('obstaclesWithin4Atr', 0), ('obstaclesWithin4Atr', 1), ('obstaclesWithin6Atr', 0), ('obstaclesWithin6Atr', 1)]:
    op = '==' if threshold == 0 else '<='
    rules.append((f'{field}{op}{threshold}', lambda r, f=field, t=threshold: isinstance(r.get(f), (int, float)) and r[f] <= t))
for threshold in [60, 70, 80]:
    rules.append((f'fromScore>={threshold}', lambda r, t=threshold: ((r.get('from') or {}).get('score') or -1) >= t))
for threshold in [0, 1]:
    rules.append((f'fromTouches<={threshold}', lambda r, t=threshold: ((r.get('from') or {}).get('touches') if (r.get('from') or {}).get('touches') is not None else 999) <= t))

rule_rows = []
for name, predicate in rules:
    selected = [r for r in all_rows if predicate(r)]
    per_window = {}
    window_positive_lift = 0
    nonempty_windows = 0
    for window, rows in window_rows.items():
        subset = [r for r in rows if predicate(r)]
        if not subset:
            per_window[window] = {'episodes': 0, 'targetPassRatePct': None, 'baselineRatePct': rnd(rate(rows) * 100, 2), 'liftPp': None}
            continue
        nonempty_windows += 1
        lift = (rate(subset) - rate(rows)) * 100
        if lift >= 0:
            window_positive_lift += 1
        per_window[window] = {
            'episodes': len(subset),
            'targetPassRatePct': rnd(rate(subset) * 100, 2),
            'baselineRatePct': rnd(rate(rows) * 100, 2),
            'liftPp': rnd(lift, 2),
        }
    lift_pp = (rate(selected) - baseline_rate) * 100 if selected else None
    robust = bool(
        len(selected) >= 100
        and nonempty_windows == len(window_rows)
        and lift_pp is not None and lift_pp >= 10
        and window_positive_lift == nonempty_windows
    )
    rule_rows.append({
        'rule': name,
        'metrics': stats(selected),
        'liftPp': rnd(lift_pp, 2),
        'perWindow': per_window,
        'robustDiagnosticSignal': robust,
    })

rule_rows.sort(key=lambda x: ((x['robustDiagnosticSignal']), x['liftPp'] if x['liftPp'] is not None else -999, x['metrics']['episodes']), reverse=True)

report = {
    'version': 'SMOKE_V5_FREE_SPACE_OBSTACLE_DENSITY_AUDIT_V1',
    'purpose': 'Diagnose whether causal geometry already visible from the FROM zone and pre-existing opposite HTF obstacles predicts later production RR viability, without changing entry/stop/target logic.',
    'definition': {
        'obstacles': 'Active opposite eligible 4H/1D/1W zones meeting frozen production target thresholds and existing no later than the 5m reaction time.',
        'preReactionGap': 'Directional distance from the departure edge of the FROM zone to each pre-existing opposite obstacle, normalized by ATR15.',
        'outcome': 'Later frozen production geometry has first synchronized target >=1.8R.',
        'robustSignalCriterion': '>=100 episodes, present in both fixed windows, aggregate target-pass lift >=10 percentage points, and non-negative lift in every window.',
    },
    'overall': stats(all_rows),
    'byWindow': {k: stats(v) for k, v in sorted(window_rows.items())},
    'distributions': {
        'fromSource': group(all_rows, lambda r: (r.get('from') or {}).get('source')),
        'fromTimeframe': group(all_rows, lambda r: (r.get('from') or {}).get('timeframe')),
        'firstObstacleSource': group(all_rows, lambda r: (r.get('first') or {}).get('source')),
        'firstObstacleTimeframe': group(all_rows, lambda r: (r.get('first') or {}).get('timeframe')),
        'rangePosition': group(all_rows, lambda r: r.get('rangePosition')),
        'trendStrength': group(all_rows, lambda r: r.get('trendStrength')),
        'reactionType': group(all_rows, lambda r: r.get('reactionType')),
    },
    'predeclaredRules': rule_rows,
    'topRobustSignals': [r for r in rule_rows if r['robustDiagnosticSignal']][:10],
}

OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps({
    'episodes': report['overall']['episodes'],
    'targetPassRatePct': report['overall']['targetPassRatePct'],
    'robustSignals': [r['rule'] for r in report['topRobustSignals']],
}, ensure_ascii=False))
