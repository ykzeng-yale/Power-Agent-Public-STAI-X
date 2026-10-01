#!/usr/bin/env python3
"""Install only the bundled scientific skill; preserve other agent settings."""
import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--target', choices=['codex', 'claude'], required=True)
parser.add_argument('--project', type=Path)
parser.add_argument('--destination', type=Path, help='Explicit skills parent directory')
parser.add_argument('--replace', action='store_true')
args = parser.parse_args()
source = Path(__file__).resolve().parent / 'power-agent-scientific'
if args.destination:
    parent = args.destination.expanduser().resolve()
elif args.project:
    parent = args.project.expanduser().resolve() / ('.codex' if args.target == 'codex' else '.claude') / 'skills'
elif args.target == 'codex':
    parent = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'skills'
else:
    parent = Path.home() / '.claude' / 'skills'
destination = parent / source.name
if destination.exists():
    if not args.replace:
        parser.error(f'Existing skill preserved at {destination}; use --replace to back it up and replace')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = destination.with_name(destination.name + '.backup-' + stamp)
    destination.rename(backup)
    print(f'Preserved previous installation: {backup}')
parent.mkdir(parents=True, exist_ok=True)
shutil.copytree(source, destination)
print(f'Installed {args.target} scientific skill: {destination}')
