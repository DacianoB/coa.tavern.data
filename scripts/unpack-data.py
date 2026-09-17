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
    if not compressed.exists() and entry.get('compressedParts'):
        parts = entry['compressedParts']
        for part in parts:
            source = root / part['file']
            if not source.is_file():
                raise SystemExit(f'Missing download part: {source.name}')
            with source.open('rb') as handle:
                if source.stat().st_size != part['bytes'] or hashlib.file_digest(handle, 'sha256').hexdigest() != part['sha256']:
                    raise SystemExit(f'Part checksum/size mismatch: {source.name}')
        assembled = compressed.with_name(compressed.name + '.assembling')
        with assembled.open('xb') as target:
            for part in parts:
                with (root / part['file']).open('rb') as source:
                    shutil.copyfileobj(source, target)
        with assembled.open('rb') as handle:
            if hashlib.file_digest(handle, 'sha256').hexdigest() != entry['compressedSha256']:
                raise SystemExit(f'Assembled checksum mismatch: {compressed.name}')
        assembled.rename(compressed)
        print(f'Joined and verified {len(parts)} parts: {compressed.name}')
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
