from __future__ import annotations

import json
import math
import statistics
import sys
from pathlib import Path

indir = Path(sys.argv[1] if len(sys.argv) > 1 else 'entry-timing-results')
out = Path(sys.argv[2] if len(sys.argv) > 2 else 'entry-timing-geometry-summary.json')

rows = [json.loads(p.read_text()) for p in sorted(indir.glob('*.json'))]
episodes = []
for row in rows:
    for result in row.get('results', []):
        episodes.extend(result.get('entryTimingEpisodes', []))


def finite(v):
    return isinstance(v, (int, float)) and math.isfinite(v)


def median(values):
    vals = [float(v) for v in values if finite(v)]
    return round(statistics.median(vals), 4) if vals else None


def pct(n, d):
    return round(n / d * 100, 2) if d else None


def summary(items):
    blocked = [x for x in items if x.get('rrBlocked')]
    close_valid = [x for x in blocked if finite(x.get('reactionCloseRR'))]
    next_valid = [x for x in blocked if finite(x.get('reactionNextOpenRR'))]
    close_rescued = [x for x in close_valid if x['reactionCloseRR'] >= 1.8]
    next_rescued = [x for x in next_valid if x['reactionNextOpenRR'] >= 1.8]
    return {
        'episodes': len(items),
        'rrBlocked': len(blocked),
        'productionRRMedian': median([x.get('productionRR') for x in blocked]),
        'reactionCloseRRMedian': median([x.get('reactionCloseRR') for x in blocked]),
        'reactionNextOpenRRMedian': median([x.get('reactionNextOpenRR') for x in blocked]),
        'directionalDelayRMedian': median([x.get('directionalDelayR') for x in blocked]),
        'directionalDelayPctMedian': median([x.get('directionalDelayPct') for x in blocked]),
        'confirmationLagMinutesMedian': median([x.get('confirmationLagMinutes') for x in blocked]),
        'reactionCloseRescuedTo18': len(close_rescued),
        'reactionCloseRescueRatePct': pct(len(close_rescued), len(blocked)),
        'reactionNextOpenRescuedTo18': len(next_rescued),
        'reactionNextOpenRescueRatePct': pct(len(next_rescued), len(blocked)),
    }


def group(field):
    values = sorted({str(x.get(field)) for x in episodes})
    return {v: summary([x for x in episodes if str(x.get(field)) == v]) for v in values}


def rr_bucket(x):
    rr = x.get('productionRR')
    if not finite(rr): return 'invalid'
    if rr < 0.6: return '<0.6'
    if rr < 1.0: return '0.6-1.0'
    if rr < 1.4: return '1.0-1.4'
    if rr < 1.6: return '1.4-1.6'
    if rr < 1.8: return '1.6-1.8'
    return '>=1.8'

blocked = [x for x in episodes if x.get('rrBlocked')]
rescue_close = [x for x in blocked if finite(x.get('reactionCloseRR')) and x['reactionCloseRR'] >= 1.8]
rescue_next = [x for x in blocked if finite(x.get('reactionNextOpenRR')) and x['reactionNextOpenRR'] >= 1.8]

report = {
    'version': 'SMOKE_V5_ENTRY_TIMING_GEOMETRY_AUDIT_V1',
    'definition': 'Diagnostic only. Production stop and synchronized target are frozen at the 15m-confirmation analysis. Compare production 15m confirmation-close entry against the causal 5m reaction candle close and the immediately following 5m open. No strategy or execution rule is changed.',
    'windows': len(rows),
    'overall': summary(episodes),
    'byReactionType': group('reactionType'),
    'byZoneSource': group('zoneSource'),
    'byTargetTimeframe': group('targetTimeframe'),
    'byProductionRRBucket': {b: summary([x for x in episodes if rr_bucket(x) == b]) for b in ['<0.6','0.6-1.0','1.0-1.4','1.4-1.6','1.6-1.8','>=1.8']},
    'rescuedAtReactionCloseByReaction': {k: len([x for x in rescue_close if x.get('reactionType') == k]) for k in sorted({x.get('reactionType') for x in episodes})},
    'rescuedAtNextOpenByReaction': {k: len([x for x in rescue_next if x.get('reactionType') == k]) for k in sorted({x.get('reactionType') for x in episodes})},
    'diagnosticInterpretation': {
        'timingDominantIfReactionCloseRescueRateAtLeastPct': 25,
        'mixedIfAtLeastPct': 10,
        'note': 'These are interpretation bands, not strategy pass criteria. A rescued counterfactual is not a validated trade entry and must not be promoted without execution-aware OOS testing.'
    },
}
rate = report['overall']['reactionCloseRescueRatePct'] or 0
report['timingVerdict'] = 'TIMING_DOMINANT' if rate >= 25 else 'MIXED_TIMING_AND_STRUCTURE' if rate >= 10 else 'STRUCTURE_DOMINANT'
out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
print(json.dumps({'overall': report['overall'], 'timingVerdict': report['timingVerdict']}, ensure_ascii=False))
