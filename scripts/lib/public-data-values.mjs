export function sqliteType(type) {
  if (['int2','int4','int8','bool','oid'].includes(type)) return 'INTEGER';
  if (['float4','float8'].includes(type)) return 'REAL';
  if (type === 'bytea') return 'BLOB';
  return 'TEXT';
}

export function convert(value, column) {
  if (value === null) return null;
  const dangerousValue = /(?:postgres(?:ql)?:\/\/[^\s"<>]+:[^\s"<>]+@|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----|[A-Za-z]:\\+Users\\+|\/home\/[^/\s]+\/)/i;
  if (dangerousValue.test(value)) throw new Error(`Public export rejected a private-looking value in column ${column.name}; inspect locally before publishing.`);
  // SELECT bool_column::text emits true/false, not the raw bool wire t/f.
  if (column.pgType === 'bool') {
    if (value === 'true' || value === 't') return 1;
    if (value === 'false' || value === 'f') return 0;
    throw new Error(`Unexpected boolean encoding in ${column.name}`);
  }
  if (column.sqliteType === 'INTEGER') return BigInt(value);
  if (column.sqliteType === 'REAL') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`Non-finite value in ${column.name}; lossless conversion required.`);
    return numeric;
  }
  if (column.pgType === 'bytea') return Buffer.from(value.slice(2), 'hex');
  return value;
}
