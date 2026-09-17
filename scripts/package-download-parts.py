"""Split large gzip downloads into 24 MiB byte parts and update their manifest."""
from pathlib import Path
import hashlib, json, sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'data')
manifest_path = root / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
for entry in manifest['files']:
    if entry['compressedBytes'] <= 100 * 1024 * 1024:
        continue
    if entry.get('compressedParts'):
        raise SystemExit(f"Parts are already recorded for {entry['compressedFile']}")
    source = root / entry['compressedFile']
    with source.open('rb') as handle:
        if hashlib.file_digest(handle, 'sha256').hexdigest() != entry['compressedSha256']:
            raise SystemExit(f'Checksum mismatch: {source.name}')
    parts = []
    with source.open('rb') as handle:
        while block := handle.read(24 * 1024 * 1024):
            name = source.name + f'.part{len(parts) + 1:02d}'
            with (root / name).open('xb') as target:
                target.write(block)
            parts.append({'file': name, 'bytes': len(block), 'sha256': hashlib.sha256(block).hexdigest()})
    entry['compressedParts'] = parts
    print(f'{source.name}: {len(parts)} parts; original gzip retained.')
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
