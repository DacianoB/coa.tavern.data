"""Verify and unpack downloaded release assets using only Python's standard library."""
from pathlib import Path
import gzip, hashlib, json, shutil, sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'data')
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
for entry in manifest['files']:
    compressed = root / entry['compressedFile']
    output = root / entry['file']
    if output.exists():
        raise SystemExit(f'Refusing to overwrite {output}')
    with compressed.open('rb') as handle:
        if hashlib.file_digest(handle, 'sha256').hexdigest() != entry['compressedSha256']:
            raise SystemExit(f'Compressed checksum mismatch: {compressed.name}')
    temporary = output.with_suffix('.partial')
    with gzip.open(compressed, 'rb') as source, temporary.open('xb') as target:
        shutil.copyfileobj(source, target)
    with temporary.open('rb') as handle:
        if hashlib.file_digest(handle, 'sha256').hexdigest() != entry['sha256']:
            raise SystemExit(f'Database checksum mismatch: {output.name}')
    temporary.rename(output)
    print(f'Unpacked and verified {output.name}')
