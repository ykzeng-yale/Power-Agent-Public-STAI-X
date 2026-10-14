#!/usr/bin/env python3
"""Install only the bundled scientific skill; preserve other agent settings."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--target', choices=['codex', 'claude'], required=True)
parser.add_argument('--project', type=Path)
parser.add_argument('--destination', type=Path, help='Explicit skills parent directory')
parser.add_argument('--replace', action='store_true')
parser.add_argument('--dry-run', action='store_true', help='Report the destination without writing files')
args = parser.parse_args()
source = Path(__file__).resolve().parent / 'power-agent-scientific'
if args.destination:
    parent = args.destination.expanduser().resolve()
elif args.project:
    parent = args.project.expanduser().resolve() / ('.agents' if args.target == 'codex' else '.claude') / 'skills'
elif args.target == 'codex':
    parent = Path.home() / '.agents' / 'skills'
else:
    parent = Path.home() / '.claude' / 'skills'
destination = parent / source.name
if destination.exists():
    if not args.replace:
        parser.error(f'Existing skill preserved at {destination}; use --replace to back it up and replace')
    if args.dry_run:
        print(f'Would back up and replace existing {args.target} scientific skill: {destination}')
        raise SystemExit(0)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    # Keep old SKILL.md outside live discovery to avoid duplicate same-name skills.
    backup_parent = parent.with_name(parent.name + '-backups')
    backup_parent.mkdir(parents=True, exist_ok=True)
    backup = backup_parent / (destination.name + '.backup-' + stamp)
    destination.rename(backup)
    print(f'Preserved previous installation: {backup}')
if args.dry_run:
    print(f'Would install {args.target} scientific skill: {destination}')
    raise SystemExit(0)
parent.mkdir(parents=True, exist_ok=True)
shutil.copytree(source, destination)
print(f'Installed {args.target} scientific skill: {destination}')
