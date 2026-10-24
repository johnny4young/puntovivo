"""Apply this focus PR to a NEW pinned private composition after #348.
Usage: python3 scripts/reproduce-product-focus.py NEW_COMPOSITION_DIRECTORY EXACT_FOCUS_HEAD
No merge, install, test, push, database or provider access is performed.
"""
from pathlib import Path
import json
import re
import subprocess
import sys

repo = Path(sys.argv[1]).resolve()
sha = sys.argv[2]
if not re.fullmatch('[a-f0-9]{40}', sha):
    raise ValueError('Supply the exact published 40-character focus head')
receipt_path = repo / '.composition-reproduction.json'
receipt = json.loads(receipt_path.read_text())
assert receipt['sourceHead'] == '275d549e845bc07fbf04e91aa5775fc47277e617'
assert receipt['productFix'] == 'c32011ac8a80cc07a0ced556fcfe6f074ce0ccc3'
assert receipt['346'] == 'f7e5a4f3066bbabfa9bfce77e7c77408d58830fd'
assert receipt['347'] == 'cb3cfed99e999d93bc126b4ef33a7012737d1231'
assert receipt['toastFix'] == '0b5122d6eb393ee3d1a67d9b8ea358683bc4f76e'
assert not receipt.get('focusFix'), 'Do not reapply to an existing repaired recipe'
subprocess.run(['git', 'fetch', 'origin', sha], cwd=repo, check=True)
base = receipt['347']
files = subprocess.check_output(['git', 'diff', '--name-only', base, sha], cwd=repo, text=True).splitlines()
for name in files:
    target = (repo / name).resolve()
    if not target.is_relative_to(repo):
        raise ValueError('Invalid tracked path')
    if name == 'docs/translations.json':
        continue
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(subprocess.check_output(['git', 'show', sha + ':' + name], cwd=repo))
registry_path = repo / 'docs/translations.json'
registry = json.loads(registry_path.read_text())
changes = json.loads(subprocess.check_output(['git', 'show', sha + ':docs/translations.json'], cwd=repo))
for pair in changes['pairs']:
    old = next((p for p in registry['pairs'] if p['en'] == pair['en'] or p['es'] == pair['es']), None)
    if old and old != pair:
        raise ValueError('Conflicting translation pair')
    if not old:
        registry['pairs'].append(pair)
registry_path.write_text(json.dumps(registry, indent=2) + '\n')
receipt['focusFix'] = sha
receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
