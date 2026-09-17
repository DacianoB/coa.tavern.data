import { DatabaseSync } from 'node:sqlite';
import { readFileSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'data');
const manifest = JSON.parse(readFileSync(path.join(root,'manifest.json'),'utf8'));
const allowlist = JSON.parse(readFileSync(new URL('./public-tables.json',import.meta.url),'utf8'));
const quote = value => '"' + value.replaceAll('"','""') + '"';
async function digest(file) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
for (const entry of manifest.files) {
  const fullPath=path.join(root,entry.file);
  if (statSync(fullPath).size !== entry.bytes || await digest(fullPath) !== entry.sha256) throw new Error(`Checksum/size mismatch: ${entry.file}`);
  const compressed=path.join(root,entry.compressedFile);
  if (existsSync(compressed) && (statSync(compressed).size !== entry.compressedBytes || await digest(compressed) !== entry.compressedSha256)) throw new Error(`Compressed checksum/size mismatch: ${entry.compressedFile}`);
  const db=new DatabaseSync(fullPath,{readOnly:true});
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error(`${entry.file}: corrupt SQLite`);
  const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  if (JSON.stringify(names) !== JSON.stringify(entry.tables.map(t=>t.name).sort())) throw new Error(`${entry.file}: table inventory mismatch`);
  for (const table of entry.tables) {
    if (!allowlist[entry.sourceSchema].includes(table.name)) throw new Error(`Table outside public allowlist: ${table.name}`);
    if (db.prepare(`SELECT count(*) AS n FROM ${quote(table.name)}`).get().n !== table.rows) throw new Error(`Count mismatch: ${table.name}`);
    const columns=db.prepare(`PRAGMA table_info(${quote(table.name)})`).all();
    if (JSON.stringify(columns.map(c=>[c.name,c.type])) !== JSON.stringify(table.columns.map(c=>[c.name,c.sqliteType]))) throw new Error(`Column mismatch: ${table.name}`);
    const primaryKey=columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
    if (JSON.stringify(primaryKey) !== JSON.stringify(table.primaryKey)) throw new Error(`Primary-key mismatch: ${table.name}`);
  }
  db.close();
  console.log(`${entry.file}: checksum, integrity, ${entry.tables.length} tables, all row counts, columns and primary keys OK`);
}
