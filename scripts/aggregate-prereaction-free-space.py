from __future__ import annotations

import json
import math
import sys
from pathlib import Path

INPUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'free-space-results')
OUTPUT = Path(sys.argv[2] if len(sys.argv) > 2 else 'prereaction-free-space-summary.json')


def rnd(value, digits=4):
    if value is None or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return round(value, digits)


def rate(num, den):
    return rnd(num / den * 100, 2) if den else None


def summarize(rows):
    reactions = [r for r in rows if r.get('reactionConfirmed')]
    confirmations = [r for r in rows if r.get('confirmationObserved')]
    rr_pass = [r for r in confirmations if r.get('rrPass18')]
    rrs = sorted(r['productionRr'] for r in confirmations if isinstance(r.get('productionRr'), (int, float)))
    return {
        'snapshots': len(rows),
        'reactions': len(reactions),
        'reactionRatePct': rate(len(reactions), len(rows)),
        'confirmations': len(confirmations),
        'confirmationRatePct': rate(len(confirmations), len(rows)),
        'rrPass18': len(rr_pass),
        'rrPassRatePctOfConfirmations': rate(len(rr_pass), len(confirmations)),
        'medianProductionRr': rnd(rrs[len(rrs)//2] if rrs else None),
    }


def file_window(path):
    name = path.name.lower()
    if 'free-space-a' in name or 'geometry-a' in name:
        return 'window-a'
    if 'free-space-b' in name or 'geometry-b' in name:
        return 'window-b'
    return path.stem

files = sorted(INPUT.glob('*.json'))
windows = {}
all_rows = []
for path in files:
    data = json.loads(path.read_text())
    key = file_window(path)
    rows = []
    for result in data.get('results', []):
        for episode in result.get('preReactionEpisodes', []):
            row = dict(episode)
            row['window'] = key
            rows.append(row)
    windows.setdefault(key, []).extend(rows)
    all_rows.extend(rows)

baseline = summarize(all_rows)

# Fixed, predeclared grid. Do not move these thresholds after seeing results.
candidates = [
    ('freeSpace>=0.5ATR', lambda r: (r.get('freeSpaceAtr') or -1) >= 0.5),
    ('freeSpace>=1.0ATR', lambda r: (r.get('freeSpaceAtr') or -1) >= 1.0),
    ('freeSpace>=1.5ATR', lambda r: (r.get('freeSpaceAtr') or -1) >= 1.5),
    ('freeSpace>=2.0ATR', lambda r: (r.get('freeSpaceAtr') or -1) >= 2.0),
    ('freeSpace>=2.5ATR', lambda r: (r.get('freeSpaceAtr') or -1) >= 2.5),
    ('freeSpace>=3.0ATR', lambda r: (r.get('freeSpaceAtr') or -1) >= 3.0),
    ('obstacles2ATR=0', lambda r: r.get('obstacles2Atr') == 0),
    ('obstacles2ATR<=1', lambda r: isinstance(r.get('obstacles2Atr'), int) and r.get('obstacles2Atr') <= 1),
    ('freeSpace>=1.5ATR & obstacles2ATR<=1', lambda r: (r.get('freeSpaceAtr') or -1) >= 1.5 and isinstance(r.get('obstacles2Atr'), int) and r.get('obstacles2Atr') <= 1),
    ('freeSpace>=2.0ATR & obstacles2ATR<=1', lambda r: (r.get('freeSpaceAtr') or -1) >= 2.0 and isinstance(r.get('obstacles2Atr'), int) and r.get('obstacles2Atr') <= 1),
    ('freeSpace>=2.0ATR & obstacles2ATR=0', lambda r: (r.get('freeSpaceAtr') or -1) >= 2.0 and r.get('obstacles2Atr') == 0),
    ('freeSpace>=2.5ATR & obstacles2ATR<=1', lambda r: (r.get('freeSpaceAtr') or -1) >= 2.5 and isinstance(r.get('obstacles2Atr'), int) and r.get('obstacles2Atr') <= 1),
]

candidate_rows = []
base_rr_rate = baseline.get('rrPassRatePctOfConfirmations') or 0
for name, pred in candidates:
    selected = [r for r in all_rows if pred(r)]
    overall = summarize(selected)
    per_window = {key: summarize([r for r in rows if pred(r)]) for key, rows in windows.items()}
    rr_rate = overall.get('rrPassRatePctOfConfirmations') or 0
    confirmations = overall.get('confirmations') or 0
    nonempty_windows = [v for v in per_window.values() if (v.get('confirmations') or 0) > 0]
    both_windows_support = len(nonempty_windows) == len(windows) and len(windows) >= 2
    each_window_above_baseline = both_windows_support and all(
        (v.get('rrPassRatePctOfConfirmations') or 0) >= base_rr_rate
        for v in nonempty_windows
    )
    robust = (
        confirmations >= 30
        and rr_rate >= base_rr_rate * 2
        and rr_rate >= base_rr_rate + 3
        and both_windows_support
        and each_window_above_baseline
    )
    candidate_rows.append({
        'name': name,
        'overall': overall,
        'perWindow': per_window,
        'rrPassLiftVsBaseline': rnd(rr_rate / base_rr_rate if base_rr_rate > 0 else None, 3),
        'robustDiagnosticSignal': robust,
    })

# Descriptive bins, also fixed before result inspection.
def fs_bin(value):
    if value is None:
        return 'no-obstacle'
    if value < 0.5: return '<0.5'
    if value < 1.0: return '0.5-1.0'
    if value < 1.5: return '1.0-1.5'
    if value < 2.0: return '1.5-2.0'
    if value < 3.0: return '2.0-3.0'
    return '>=3.0'

bins = {}
for row in all_rows:
    key = fs_bin(row.get('freeSpaceAtr'))
    bins.setdefault(key, []).append(row)

report = {
    'version': 'SMOKE_V5_PREREACTION_FREE_SPACE_AUDIT_V1',
    'definition': 'Snapshot is captured at the first near/inside/departing observation of a selected FROM zone while no full 5m reaction is yet confirmed. Free-space and obstacle density use only active HTF zones already available at that snapshot. Later reaction/15m confirmation/production RR are attached as outcomes without changing the snapshot.',
    'windows': {key: summarize(rows) for key, rows in windows.items()},
    'baseline': baseline,
    'freeSpaceBins': {key: summarize(rows) for key, rows in sorted(bins.items())},
    'predeclaredCandidateCriteria': {
        'minimumConfirmations': 30,
        'rrPassLift': '>=2.0x baseline and >= baseline + 3 percentage points',
        'windowStability': 'candidate has confirmations in both fixed 180d windows and RR-pass rate is >= aggregate baseline in each window',
        'diagnosticOnly': True,
    },
    'candidates': candidate_rows,
    'robustSignals': [row['name'] for row in candidate_rows if row['robustDiagnosticSignal']],
    'verdict': 'ROBUST_FREE_SPACE_SIGNAL_FOUND' if any(row['robustDiagnosticSignal'] for row in candidate_rows) else 'NO_ROBUST_FREE_SPACE_SIGNAL_YET',
}

OUTPUT.write_text(json.dumps(report, indent=2, ensure_ascii=False))
print(json.dumps({
    'verdict': report['verdict'],
    'baseline': baseline,
    'robustSignals': report['robustSignals'],
    'candidateCount': len(candidate_rows),
}, ensure_ascii=False))
