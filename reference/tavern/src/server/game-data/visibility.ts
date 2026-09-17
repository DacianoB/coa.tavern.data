import type { EntityKind } from '@/lib/entities';

export const hiddenItemNames = [
  '[MISSING ITEM NAME]',
  '***No Name***',
  '***Name Not Available***',
  '****No Name****'
];

export const hiddenItemNameFragments = [
  'DNT',
  'DEPRECATED',
  'DEPRECATEAD',
  'QA',
  '[DEP]',
  '[UNUSED]'
];

export function isVisibleGameEntityName(kind: EntityKind, name: string) {
  if (kind !== 'items') {
    return true;
  }

  const normalized = name.trim().toLowerCase();
  return (
    !hiddenItemNames.some(
      (hiddenName) => hiddenName.toLowerCase() === normalized
    ) &&
    !hiddenItemNameFragments.some((fragment) =>
      normalized.includes(fragment.toLowerCase())
    )
  );
}

export function hiddenItemNamesArraySql() {
  return `ARRAY[${hiddenItemNames
    .map((name) => `'${name.replace(/'/g, "''")}'`)
    .join(', ')}]`;
}

export function hiddenItemNameFragmentsArraySql() {
  return `ARRAY[${hiddenItemNameFragments
    .map((fragment) => `'${fragment.replace(/'/g, "''")}'`)
    .join(', ')}]`;
}
