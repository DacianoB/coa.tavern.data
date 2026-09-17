# Data archive rules

This repository is a data/research archive, not an application. Do not add a
website, server, UI, application framework or app build system.

Preserve original raw file bytes, relative paths, game IDs, table names and
column names. Keep corrupt/incomplete captures and label their status. Do not
invent authoritative server mechanics from tooltips or interpolation.

Organize findings under info/, parsed data under data/, raw file inventories
under raw/, and historical extraction/import logic under scripts/ and reference/.
Publish large raw archives and DB snapshots as release assets with SHA-256 hashes.

Public DB exports use scripts/public-tables.json. Never publish credentials,
personal/community records, character logs, account folders or mixed private
backups. Export source databases read only; don't change the original project.

Keep measured, inferred, placeholder and missing values distinct. Cite evidence
and reproducible SQL/code for findings. Preserve zero, negatives and integer
precision. Verify DB checksums/counts/integrity and raw archive member hashes.

When asked to open an issue, include Problem, Expected behavior, /plan and
Acceptance criteria with concrete implementation and validation steps.
