#!/usr/bin/env python3
"""Check saved native-review receipt consistency, not execution or scientific truth."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys


def audit(record, base):
    issues = []
    checked = {}
    base = base.resolve()
    hashes = record.get('files_sha256', {})

    def fail(message):
        issues.append(message)

    def file(name):
        if not isinstance(name, str) or not name:
            fail('Missing receipt/file path')
            return None
        relative = Path(name)
        path = base / relative
        if relative.is_absolute() or '..' in relative.parts or path.is_symlink() or not path.resolve().is_relative_to(base):
            fail('File path must stay within the private receipt directory: ' + name)
            return None
        try:
            raw = path.read_bytes()
        except OSError:
            fail('Referenced file is unavailable: ' + name)
            return None
        digest = hashlib.sha256(raw).hexdigest()
        checked[name] = digest
        if not raw:
            fail('Referenced file is empty: ' + name)
        if not isinstance(hashes, dict) or hashes.get(name) != digest:
            fail('Missing or mismatched SHA256: ' + name)
        return digest

    def time(value):
        try:
            result = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if result.tzinfo is None:
                raise ValueError()
            return result
        except (ValueError, TypeError, AttributeError):
            fail('Require timezone-bearing execution/disclosure timestamps')
            return None

    if record.get('schema_version') != '1.0.0' or record.get('requested_mode') != 'multi':
        fail('Require the native multi-review schema version 1.0.0')
    implementer, reviewer = record.get('implementation_session_id'), record.get('reviewer_session_id')
    if not isinstance(implementer, str) or not implementer.strip() or not isinstance(reviewer, str) or not reviewer.strip() or implementer == reviewer:
        fail('Require distinct nonempty implementation and reviewer session IDs')
    inputs, initial = record.get('input_files'), record.get('reviewer_initial_files')
    if not isinstance(inputs, list) or not inputs or not all(isinstance(p, str) for p in inputs):
        fail('Require actual original input file paths')
        inputs = []
    if not isinstance(initial, list) or not initial or not all(isinstance(p, str) for p in initial):
        fail('Require declared reviewer initial-context file paths')
        initial = []
    if not set(inputs).issubset(initial):
        fail('Reviewer initial context omits supplied input files')
    initial_hashes = {digest for p in initial if (digest := file(p)) is not None}
    for p in inputs:
        file(p)
    file(record.get('launch_receipt'))
    precheck, disclosure, comparison = (record.get(key, {}) for key in ['precheck', 'disclosure', 'comparison'])
    if not all(isinstance(item, dict) for item in [precheck, disclosure, comparison]):
        fail('Require precheck, disclosure and comparison objects')
        precheck, disclosure, comparison = {}, {}, {}
    for key in ['code', 'output', 'receipt']:
        file(precheck.get(key))
    if type(precheck.get('exit_code')) is not int or precheck['exit_code'] != 0:
        fail('Precheck did not record successful execution')
    candidate = file(disclosure.get('candidate_code'))
    candidate_output = file(disclosure.get('candidate_output'))
    if any(value is not None and value in initial_hashes for value in [candidate, candidate_output]):
        fail('Candidate bytes occur in declared reviewer initial context')
    file(comparison.get('receipt'))
    if candidate is None or comparison.get('candidate_code_sha256') != candidate:
        fail('Comparison does not bind the disclosed candidate code digest')
    if candidate_output is None or comparison.get('candidate_output_sha256') != candidate_output:
        fail('Comparison does not bind the disclosed candidate output digest')
    if comparison.get('verdict') not in ['pass', 'revise', 'needs_clarification']:
        fail('Require an explicit comparison verdict')
    before, disclosed, after = time(precheck.get('completed_at')), time(disclosure.get('at')), time(comparison.get('completed_at'))
    if all(value is not None for value in [before, disclosed, after]) and not before < disclosed <= after:
        fail('Precheck must complete before disclosure and comparison')
    return {'schema_version': '1.0.0', 'status': 'inconsistent' if issues else 'receipt_consistent',
            'passed': not issues, 'issues': issues, 'checked_files_sha256': checked,
            'recorded_comparison_verdict': comparison.get('verdict'),
            'scope': 'Declared file/session/digest/chronology consistency only; does not authenticate receipts, observe host execution, inspect undisclosed context, certify blindness or validate science.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        raw = args.manifest.read_bytes()
        record = json.loads(raw)
        if not isinstance(record, dict):
            raise ValueError('Require a JSON object')
        result = audit(record, args.manifest.parent)
        result['manifest_sha256'] = hashlib.sha256(raw).hexdigest()
    except (OSError, ValueError, TypeError) as error:
        sys.stderr.write(str(error) + '\n')
        return 2
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    return 0 if result['passed'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
