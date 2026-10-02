#!/usr/bin/env python3
"""Check declared sample-size arithmetic for equal-allocation native records.

This is an internal unit-consistency check, not a power or method certifier.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

UNITS = {'participants_per_arm', 'participants_total', 'clusters_per_arm', 'clusters_total'}

def audit(record):
    design = record.get('design', {})
    arms = design.get('arms')
    ratio = design.get('allocation_ratio')
    cluster_size = design.get('cluster_size')
    issues, checked = [], []
    if isinstance(arms, bool) or not isinstance(arms, int) or arms < 2:
        issues.append('design.arms must be an integer >=2')
    if isinstance(ratio, bool) or not isinstance(ratio, (int, float)) or ratio != 1:
        issues.append('This checker supports explicit equal allocation only (allocation_ratio=1)')
    if cluster_size is not None and (isinstance(cluster_size, bool) or not isinstance(cluster_size, (int, float)) or not math.isfinite(cluster_size) or cluster_size < 1 or cluster_size % 1):
        issues.append('cluster_size must be a positive integer when supplied')
    stages = {}
    for row in record.get('results', []):
        if not isinstance(row, dict) or row.get('unit') not in UNITS:
            continue
        metric, value, unit = row.get('metric'), row.get('value'), row.get('unit')
        if not isinstance(metric, str) or not metric or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            issues.append('Each declared sample-size quantity requires a metric and finite nonnegative numeric value')
            continue
        if unit in stages.setdefault(metric, {}):
            issues.append(f'{metric}: duplicate {unit}')
        stages[metric][unit] = value
    if not stages:
        issues.append('No supported sample-size quantities found')
    def same(a, b):
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(arms, int) and not isinstance(arms, bool) and arms >= 2 and ratio == 1:
        for metric, quantities in stages.items():
            for family in ['participants', 'clusters']:
                per, total = family + '_per_arm', family + '_total'
                if per in quantities or total in quantities:
                    if per not in quantities or total not in quantities:
                        issues.append(f'{metric}: provide paired {per} and {total}')
                    elif not same(quantities[total], arms * quantities[per]):
                        issues.append(f'{metric}: {total} is not arms times {per}')
                    else:
                        checked.append(f'{metric}: {family} total/per-arm arithmetic')
            for suffix in ['_per_arm', '_total']:
                participants, clusters = 'participants' + suffix, 'clusters' + suffix
                if participants in quantities and clusters in quantities:
                    if not isinstance(cluster_size, (int, float)) or isinstance(cluster_size, bool) or not math.isfinite(cluster_size) or cluster_size <= 0:
                        issues.append(f'{metric}: clustered counts require explicit cluster_size')
                    elif not same(quantities[participants], cluster_size * quantities[clusters]):
                        issues.append(f'{metric}: participant count does not equal cluster count times cluster_size ({suffix})')
                    else:
                        checked.append(f'{metric}: participant/cluster arithmetic ({suffix})')
    return {'checker_version': '1.0.0', 'status': 'passed' if not issues else 'failed', 'passed': not issues, 'checks': checked, 'issues': issues,
            'limitation': 'Checks declared equal-allocation units only. Does not certify the method, source inputs, power formula, or provenance.'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    raw = args.record.read_bytes()
    result = audit(json.loads(raw))
    result['record_sha256'] = hashlib.sha256(raw).hexdigest()
    serialized = json.dumps(result, indent=2) + '\n'
    if args.output:
        args.output.write_text(serialized)
    sys.stdout.write(serialized)
    return 0 if result['passed'] else 2

if __name__ == '__main__':
    raise SystemExit(main())
