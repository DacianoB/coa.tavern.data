"""Verify downloaded raw ZIP archives and every original member against their manifest."""
from pathlib import Path
import hashlib, json, sys, zipfile

root=Path(sys.argv[1] if len(sys.argv)>1 else 'raw')
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
for entry in manifest['archives']:
    archive=root/entry['file']
    with archive.open('rb') as handle:
        if hashlib.file_digest(handle,'sha256').hexdigest()!=entry['sha256']:
            raise SystemExit('Archive checksum mismatch: '+archive.name)
    with zipfile.ZipFile(archive) as z:
        if set(z.namelist())!={file['path'] for file in entry['files']}:
            raise SystemExit('Archive member inventory mismatch: '+archive.name)
        for file in entry['files']:
            info=z.getinfo(file['path'])
            if info.file_size!=file['bytes']:raise SystemExit('Size mismatch: '+file['path'])
            with z.open(file['path']) as handle:
                if hashlib.file_digest(handle,'sha256').hexdigest()!=file['sha256']:
                    raise SystemExit('Member checksum mismatch: '+file['path'])
    print(f"{archive.name}: {entry['fileCount']} original files verified",flush=True)
