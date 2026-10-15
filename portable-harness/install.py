#!/usr/bin/env python3
"""Install the integrity-checked scientific skill; preserve other agent settings."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

def verify_tree(source, expected):
    if not isinstance(expected, dict) or not expected:
        raise ValueError('Manifest has no skill file digests')
    actual = set()
    for path in source.rglob('*'):
        if path.is_symlink():
            raise ValueError('Skill symlinks are not accepted: ' + str(path))
        if path.is_file():
            actual.add(path.relative_to(source).as_posix())
    if actual != set(expected):
        raise ValueError('Skill file inventory differs from manifest')
    for name, digest in expected.items():
        if hashlib.sha256((source / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Skill SHA256 mismatch: ' + name)

def verify_bundle(bundle):
    manifest = json.loads((bundle / 'manifest.json').read_text())
    verify_tree(bundle / 'power-agent-scientific', manifest['skill_files_sha256'])
    installed = json.loads((bundle / 'power-agent-scientific/manifest.json').read_text())
    for key in ['native_skill_version', 'native_knowledge_revision', 'harness_version',
                'scientific_principles_revision', 'scientific_principles_sha256',
                'runtime_sources_sha256', 'native_checkers', 'native_method_catalog',
                'current_optional_api_runtime']:
        if installed.get(key) != manifest.get(key):
            raise ValueError('Installed/distribution manifest metadata differs: ' + key)
    expected_installed = {name: digest for name, digest in manifest['skill_files_sha256'].items()
                          if name != 'manifest.json'}
    if installed.get('skill_files_sha256') != expected_installed:
        raise ValueError('Installed manifest file digests differ (self hash excluded)')
    for name, digest in manifest['package_support_files_sha256'].items():
        path = bundle / name
        if path.is_symlink() or path.parent != bundle or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('Package support SHA256 mismatch: ' + name)
    return manifest

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--target', choices=['codex', 'claude'], required=True)
parser.add_argument('--project', type=Path)
parser.add_argument('--destination', type=Path, help='Explicit skills parent directory')
parser.add_argument('--replace', action='store_true')
parser.add_argument('--dry-run', action='store_true', help='Report the destination without writing files')
args = parser.parse_args()
bundle = Path(__file__).resolve().parent
source = bundle / 'power-agent-scientific'
try:
    manifest = verify_bundle(bundle)
except (OSError, ValueError, KeyError, TypeError) as error:
    parser.error('Bundle integrity check failed: ' + str(error))
if args.destination:
    parent = args.destination.expanduser().resolve()
elif args.project:
    parent = args.project.expanduser().resolve() / ('.agents' if args.target == 'codex' else '.claude') / 'skills'
elif args.target == 'codex':
    parent = Path.home() / '.agents' / 'skills'
else:
    parent = Path.home() / '.claude' / 'skills'
destination = parent / source.name
if destination.exists() or destination.is_symlink():
    if not args.replace:
        parser.error(f'Existing skill preserved at {destination}; use --replace to back it up and replace')
if args.dry_run:
    print(f'Bundle integrity checked; would install {args.target} scientific skill: {destination}')
    raise SystemExit(0)
# Copy and verify outside live discovery before moving an existing installation.
parent.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='power-agent-stage-', dir=parent.parent) as temporary:
    staged = Path(temporary) / source.name
    shutil.copytree(source, staged)
    verify_tree(staged, manifest['skill_files_sha256'])
    parent.mkdir(parents=True, exist_ok=True)
    backup = None
    if destination.exists() or destination.is_symlink():
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup_parent = parent.with_name(parent.name + '-backups')
        backup_parent.mkdir(parents=True, exist_ok=True)
        backup = backup_parent / (destination.name + '.backup-' + stamp)
        destination.rename(backup)
    try:
        staged.rename(destination)
    except OSError:
        if backup is not None:
            backup.rename(destination)
        raise
    if backup is not None:
        print(f'Preserved previous installation: {backup}')
print(f'Installed {args.target} scientific skill: {destination}')
