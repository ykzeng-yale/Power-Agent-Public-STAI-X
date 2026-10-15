#!/usr/bin/env python3
"""Render verified native record fields without calculating scientific results."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

def render(record, raw, unit_audit, reference_audit=None):
    digest = hashlib.sha256(raw).hexdigest()
    if unit_audit.get('passed') is not True or unit_audit.get('record_sha256') != digest:
        raise ValueError('A passing unit audit must match the exact final record SHA256')
    design = record.get('design', {})
    rows = record.get('results')
    if not isinstance(design, dict) or not isinstance(rows, list) or not rows:
        raise ValueError('Require a design object and nonempty computed results array')
    by_key = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Each result must be an object')
        value, metric, unit = row.get('value'), row.get('metric'), row.get('unit')
        if not isinstance(metric, str) or not isinstance(unit, str) or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError('Each result requires a metric, unit and finite numeric computed value')
        key = (metric, unit)
        if key in by_key:
            raise ValueError('Duplicate metric/unit in final record')
        by_key[key] = value
    if design.get('reference_profile'):
        if reference_audit is None or reference_audit.get('passed') is not True:
            raise ValueError('A declared reference profile requires a passed reference audit')
        if reference_audit.get('record_sha256') != digest:
            raise ValueError('Reference audit must match the exact final record SHA256')
        if reference_audit.get('profile') != design['reference_profile']:
            raise ValueError('Reference audit profile differs from the final record')
        for row in reference_audit.get('reference_results', []):
            key = (row.get('metric'), row.get('unit'))
            if key not in by_key or not math.isclose(by_key[key], row['value'], abs_tol=1e-7, rel_tol=0):
                raise ValueError('Final computed result differs from the reference audit')
    def scalar(value):
        return json.dumps(value, ensure_ascii=False, allow_nan=False)
    def cell(value):
        return scalar(value).replace('|', '\\|').replace('\n', ' ')
    lines = ['# Executed scientific record', '',
             'Scientific status: ' + scalar(record.get('scientificStatus', 'not recorded')),
             'Requested workflow: ' + scalar(record.get('requested_workflow_mode', 'not recorded')),
             'Executed workflow: ' + scalar(record.get('executed_workflow_mode', 'not recorded')),
             'Independent agent review: ' + scalar(record.get('independent_review_status', 'not recorded')), '',
             'The mathematical reference check is a deterministic tool check. It is not a separate agent reviewer.', '',
             '## Supplied design', '', '| Field | Recorded value |', '| --- | --- |']
    lines.extend('| ' + cell(key) + ' | ' + cell(value) + ' |' for key, value in design.items())
    lines.extend(['', '## Computed quantities', '', '| Metric | Computed value | Unit |', '| --- | --- | --- |'])
    lines.extend('| ' + cell(row['metric']) + ' | ' + scalar(row['value']) + ' | ' + cell(row['unit']) + ' |' for row in rows)
    lines.extend(['', '## Recorded assumptions', '', scalar(record.get('assumptions', 'not recorded')), '',
                  '## Checks and evidence', '', 'Unit arithmetic check: ' + scalar(unit_audit.get('status')),
                  'Mathematical reference check: ' + scalar(reference_audit.get('status') if reference_audit else 'not supplied'),
                  'Final record SHA256: `' + digest + '`', '',
                  'Unit-check scope: ' + scalar(unit_audit.get('limitation', 'not recorded'))])
    if reference_audit:
        lines.append('Reference-check scope: ' + scalar(reference_audit.get('limitation', 'not recorded')))
    lines.extend(['', 'Recorded limitations: ' + scalar(record.get('limitations', 'not recorded')), '',
                  'This report copies the final computed record. It does not create new scientific quantities or certify unrecorded assumptions, source provenance, or accompanying model-written prose.', ''])
    return '\n'.join(lines)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', type=Path, required=True)
    parser.add_argument('--unit-audit', type=Path, required=True)
    parser.add_argument('--reference-audit', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    raw = args.record.read_bytes()
    try:
        result = render(json.loads(raw), raw, json.loads(args.unit_audit.read_text()),
                        json.loads(args.reference_audit.read_text()) if args.reference_audit else None)
    except (ValueError, KeyError, TypeError) as error:
        sys.stderr.write(str(error) + '\n')
        return 2
    args.output.write_text(result)
    sys.stdout.write('Rendered the exact final record to ' + str(args.output) + '\n')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
