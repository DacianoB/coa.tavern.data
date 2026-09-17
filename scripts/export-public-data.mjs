import { Pool } from 'pg';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, createWriteStream, statSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { sqliteType, convert } from './lib/public-data-values.mjs';

// Explicit allowlist: a game schema may also contain account/profile tables.
const allowlist = JSON.parse(readFileSync(new URL('./public-tables.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const envIndex = args.indexOf('--env-file');
const outIndex = args.indexOf('--out');
if (args.includes('--help')) {
  console.log('node scripts/export-public-data.mjs [--env-file .env] [--out data]\nReads a consistent PostgreSQL snapshot; creates new SQLite files and manifest. Refuses existing outputs.');
  process.exit(0);
}
for (let i = 0; i < args.length; i++) {
  if (!['--env-file', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('Invalid arguments; use --help');
  i++;
}
const envFile = envIndex < 0 ? '.env' : args[envIndex + 1];
if (existsSync(envFile)) process.loadEnvFile(envFile);
const out = path.resolve(outIndex < 0 ? 'data' : args[outIndex + 1]);
mkdirSync(out, {recursive:true});
for (const file of ['game.db', 'community-game.db', 'manifest.json']) {
  if (existsSync(path.join(out, file)) || existsSync(path.join(out, file + '.partial'))) throw new Error(`Output exists: ${file}; use a new output directory.`);
}
const connectionString = process.env.GAME_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('Set GAME_DATABASE_URL in your environment or local .env');
const pool = new Pool({connectionString, connectionTimeoutMillis:15000});
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const sourceSchema = process.env.GAME_DATABASE_SCHEMA || 'game';
const manifest = {formatVersion:1, exportedAt:new Date().toISOString(), sourceRepository:'https://github.com/DacianoB/coatavern', sourceCommit:JSON.parse(readFileSync('info/provenance/source-files.json', 'utf8')).commit, snapshot:'PostgreSQL REPEATABLE READ READ ONLY, shared across both database files', transformations:['PostgreSQL namespaces are represented by separate SQLite files.', 'Integer/bool -> INTEGER; real/double -> REAL; numeric, dates, JSON, arrays and other types -> TEXT; bytea -> BLOB.', 'Primary keys preserved; other constraints, functions, defaults, indexes and views are not recreated. Materialized views become snapshot tables.', 'No rows filtered from allowlisted tables; account, profile, logs, import metadata and other non-allowlisted tables are excluded.'], files:[], excludedTables:[], missingTables:[]};
async function sha(file) {
  const hash = createHash('sha256');
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}
let client;
let db;
try {
  client = await pool.connect();
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const relations = (await client.query("SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind IN ('r','p','m') ORDER BY 1,2", [[sourceSchema,'app']])).rows;
  manifest.excludedTables = relations.filter(r => !(allowlist[r.schema === sourceSchema ? 'game' : r.schema] ?? []).includes(r.name)).map(r => `${r.schema === sourceSchema ? 'game' : r.schema}.${r.name}`);
  for (const logicalSchema of ['game','app']) {
    const schema = logicalSchema === 'game' ? sourceSchema : 'app';
    const file = logicalSchema === 'game' ? 'game.db' : 'community-game.db';
    const temporary = path.join(out, file + '.partial');
    db = new DatabaseSync(temporary);
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN');
    const entry = {file, sourceSchema:logicalSchema, tables:[]};
    for (const table of [...allowlist[logicalSchema]].sort()) {
      const relation = relations.find(r => r.schema === schema && r.name === table);
      if (!relation) {manifest.missingTables.push(`${logicalSchema}.${table}`); continue;}
      const columns = (await client.query(`SELECT a.attname AS name, t.typname AS "pgType", format_type(a.atttypid,a.atttypmod) AS "postgresType", a.attnotnull AS "notNull" FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [schema,table])).rows.map(c => ({...c,sqliteType:sqliteType(c.pgType)}));
      const primaryKey = (await client.query(`SELECT a.attname AS name FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE i.indisprimary AND n.nspname=$1 AND c.relname=$2 ORDER BY k.ord`, [schema,table])).rows.map(r=>r.name);
      db.exec(`CREATE TABLE ${quote(table)} (${columns.map(c=>`${quote(c.name)} ${c.sqliteType}${c.notNull?' NOT NULL':''}`).join(',')}${primaryKey.length?`, PRIMARY KEY (${primaryKey.map(quote).join(',')})`:''})`);
      const insert = db.prepare(`INSERT INTO ${quote(table)} VALUES (${columns.map(()=>'?').join(',')})`);
      // Physical row order is not part of a relational snapshot. Sorting wide
      // tooltip payloads can exhaust the source server's temporary disk.
      await client.query(`DECLARE public_export_cursor NO SCROLL CURSOR FOR SELECT ${columns.map(c=>`${quote(c.name)}::text AS ${quote(c.name)}`).join(',')} FROM ${quote(schema)}.${quote(table)}`);
      let rows = 0;
      for (;;) {
        const batch = await client.query({text:'FETCH FORWARD 10000 FROM public_export_cursor',rowMode:'array'});
        if (!batch.rows.length) break;
        for (const row of batch.rows) insert.run(...row.map((value,i)=>convert(value,columns[i])));
        rows += batch.rows.length;
        if (rows % 10000 === 0) console.log(`${logicalSchema}.${table}: ${rows} rows exported...`);
      }
      await client.query('CLOSE public_export_cursor');
      const sourceCount = (await client.query(`SELECT count(*)::text AS count FROM ${quote(schema)}.${quote(table)}`)).rows[0].count;
      if (BigInt(rows) !== BigInt(sourceCount)) throw new Error(`Row count mismatch: ${table}`);
      entry.tables.push({name:table, sourceKind:relation.kind === 'm'?'materialized view':'table', rows, primaryKey, columns});
      console.log(`${logicalSchema}.${table}: ${rows} rows`);
    }
    db.exec('COMMIT');
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error(`${file}: integrity check failed`);
    db.close(); db = null;
    renameSync(temporary, path.join(out,file));
    manifest.files.push(entry);
  }
  await client.query('COMMIT');
  client.release(); client = null;
  await pool.end();
  for (const entry of manifest.files) {
    const fullPath = path.join(out,entry.file);
    entry.bytes = statSync(fullPath).size;
    entry.sha256 = await sha(fullPath);
    entry.compressedFile = entry.file + '.gz';
    await pipeline(createReadStream(fullPath), createGzip({level:9}), createWriteStream(path.join(out,entry.compressedFile),{flags:'wx'}));
    entry.compressedBytes = statSync(path.join(out,entry.compressedFile)).size;
    entry.compressedSha256 = await sha(path.join(out,entry.compressedFile));
  }
  writeFileSync(path.join(out,'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  console.log(`Wrote ${manifest.files.length} databases and manifest; PostgreSQL was read only.`);
} catch(error) {
  if (db) {try {db.close();} catch {}}
  if (client) {try {await client.query('ROLLBACK');} catch {} client.release();}
  await pool.end().catch(()=>{});
  // Do not print connection details or values from source rows.
  console.error(`Export failed: ${error.code || error.name}. ${error.message?.startsWith('Public export rejected') ? error.message : 'Inspect local configuration and any partial output; nothing has been published.'}`);
  process.exitCode=1;
}
