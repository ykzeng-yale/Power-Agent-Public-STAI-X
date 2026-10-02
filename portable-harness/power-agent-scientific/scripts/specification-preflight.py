#!/usr/bin/env python3
"""Recognize supplied inputs for simple continuous-mean design planning.

This is a conservative clarification gate, not a statistical-method certifier.
It never supplies defaults, calculates power, executes code, or installs packages.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

NUMBER = r'([+-]?(?:\d+(?:\.\d*)?|\.\d+))'
SEP = r'\s*(?:is|of|=|:)?\s*'

def inspect_request(text, kind='auto'):
    if kind == 'auto':
        # Dependence/outcome design takes precedence over incidental workflow
        # phrases such as 'independent check evidence'. Other designs need a
        # manual specification; this helper does not invent their inputs.
        if re.search(r'\b(?:paired|matched[- ]pairs?|within[- ](?:person|subject)|survival|log[- ]?rank|cox|binary|logistic|anova|one[- ]sample)\b', text, re.I): kind = 'unsupported'
        elif re.search(r'\bcluster(?:ed|[- ]randomi[sz]ed)?\b', text, re.I): kind = 'clustered_mean'
        elif re.search(r'\b(?:two[- ]sample|two[- ]arm|two\s+groups|independent\s+(?:normal(?:ly)?\s+(?:distributed\s+)?)?(?:groups|samples|means?))\b', text, re.I): kind = 'independent_mean'
        else: kind = 'unsupported'
    findings = {}
    conflicts = []
    def extract(name, patterns, convert=float, percent=False):
        candidates = []
        for pattern in patterns:
            for match in re.finditer(pattern, text, re.I):
                try: value = convert(match.group(1))
                except (ValueError, TypeError): continue
                if percent and '%' in match.group(0): value /= 100
                candidates.append({'value': value, 'source_quote': match.group(0), 'span': list(match.span())})
        distinct = {c['value'] for c in candidates}
        if len(distinct) > 1: conflicts.append(name)
        elif candidates: findings[name] = candidates[0]
    extract('standardized_effect', [r'\b(?:standardized\s+(?:mean\s+)?(?:difference|effect(?:\s+size)?)|SMD|Cohen[\x27’]?s?\s+d|d)\b' + SEP + NUMBER])
    extract('alpha', [r'\b(?:alpha|significance\s+level)\b' + SEP + NUMBER + r'\s*%?', r'α' + SEP + NUMBER + r'\s*%?'], percent=True)
    extract('target_power', [r'\b(?:target\s+)?power\b' + SEP + NUMBER + r'\s*%?', NUMBER + r'\s*%\s*(?:target\s+)?power\b'], percent=True)
    sidedness = set()
    for value, pattern in [('two-sided', r'\b(two[- ]sided|two[- ]tailed)\b'), ('one-sided', r'\b(one[- ]sided|one[- ]tailed)\b')]:
        match = re.search(pattern, text, re.I)
        if match: findings['sidedness'] = {'value': value, 'source_quote': match.group(0), 'span': list(match.span())}; sidedness.add(value)
    if len(sidedness) > 1: conflicts.append('sidedness')
    extract('allocation_ratio', [r'\b(?:allocation\s+ratio|ratio\s+of\s+treatment\s+to\s+control)' + SEP + NUMBER])
    equal = re.search(r'\b(?:equal|balanced)\s+(?:cluster\s+)?allocation\b|\b1\s*:\s*1\s+(?:cluster\s+)?allocation\b', text, re.I)
    if equal:
        if 'allocation_ratio' in findings and findings['allocation_ratio']['value'] != 1: conflicts.append('allocation_ratio')
        findings['allocation_ratio'] = {'value': 1, 'source_quote': equal.group(0), 'span': list(equal.span())}
    extract('intracluster_correlation', [r'\b(?:ICC|intra[- ]?cluster\s+correlation(?:\s+coefficient)?)\b' + SEP + NUMBER + r'\s*%?'], percent=True)
    extract('cluster_size', [r'\b(?:equal\s+)?cluster\s+size\b' + SEP + NUMBER, NUMBER + r'\s+(?:participants|individuals|subjects)\s+(?:in\s+each|per)\s+cluster\b'])
    required = ['standardized_effect', 'target_power', 'alpha', 'sidedness', 'allocation_ratio']
    if kind == 'clustered_mean': required += ['intracluster_correlation', 'cluster_size']
    invalid = []
    for name in ['alpha', 'target_power']:
        if name in findings and not 0 < findings[name]['value'] < 1: invalid.append(name)
    if 'allocation_ratio' in findings and findings['allocation_ratio']['value'] <= 0: invalid.append('allocation_ratio')
    if 'standardized_effect' in findings and findings['standardized_effect']['value'] == 0: invalid.append('standardized_effect')
    if 'intracluster_correlation' in findings and not 0 <= findings['intracluster_correlation']['value'] < 1: invalid.append('intracluster_correlation')
    if 'cluster_size' in findings and (findings['cluster_size']['value'] < 1 or findings['cluster_size']['value'] % 1): invalid.append('cluster_size')
    supported = kind in ['clustered_mean', 'independent_mean']
    missing = [name for name in required if name not in findings] if supported else []
    ready = supported and not missing and not conflicts and not invalid
    return {'preflight_version': '1.0.2', 'supported_profile': kind, 'supported': supported,
            'status': 'specified_inputs' if ready else 'needs_clarification' if supported else 'manual_specification_required',
            'ready_for_method_review': ready, 'supplied_inputs': findings, 'missing_information': missing,
            'conflicting_information': sorted(set(conflicts)), 'invalid_information': sorted(set(invalid)),
            'request_sha256': hashlib.sha256(text.encode()).hexdigest(),
            'limitation': 'Recognition is limited to simple continuous-mean sample-size requests. A ready result does not certify the method, dependence model, effect interpretation, or scientific validity. No defaults were supplied.'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--kind', choices=['auto', 'independent_mean', 'clustered_mean'], default='auto')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = inspect_request(args.request.read_text(), args.kind)
    serialized = json.dumps(result, indent=2) + '\n'
    if args.output: args.output.write_text(serialized)
    sys.stdout.write(serialized)
    return 0 if result['ready_for_method_review'] else 2

if __name__ == '__main__': raise SystemExit(main())
