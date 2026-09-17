import { cacheJson } from '@/lib/redis';

export type ExilItemReference = {
  itemLevel: number;
  requiredLevel: number;
  armor: number;
  damageMin: number;
  damageMax: number;
  stats: Record<string, number>;
};

const statTypeByLabel: Record<string, number> = {
  agility: 3,
  strength: 4,
  intellect: 5,
  spirit: 6,
  stamina: 7
};

function cleanHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function setStat(stats: Record<string, number>, type: number, value: number) {
  if (!type || !value) return;
  stats[String(type)] = value;
}

function parseExilItemHtml(html: string): ExilItemReference | null {
  const text = cleanHtml(html);
  if (!text || /Item Not Yet Loaded/i.test(text)) return null;

  const stats: Record<string, number> = {};

  for (const match of text.matchAll(
    /\+(\d+)\s+(Agility|Strength|Intellect|Spirit|Stamina)\b/gi
  )) {
    setStat(
      stats,
      statTypeByLabel[(match[2] ?? '').toLowerCase()] ?? 0,
      Number(match[1])
    );
  }

  const ratingPatterns: Array<[RegExp, number]> = [
    [/defense rating by (\d+)/i, 12],
    [/dodge rating by (\d+)/i, 13],
    [/parry rating by (\d+)/i, 14],
    [/block rating by (\d+)/i, 15],
    [/hit rating by (\d+)/i, 31],
    [/critical strike rating by (\d+)/i, 32],
    [/resilience rating by (\d+)/i, 35],
    [/haste rating by (\d+)/i, 36],
    [/expertise rating by (\d+)/i, 37],
    [/ranged attack power by (\d+)/i, 39],
    [/attack power by (\d+)/i, 38],
    [/mana per 5 sec/i, 43],
    [/armor penetration rating by (\d+)/i, 44],
    [/spell power by (\d+)/i, 45],
    [/spell penetration by (\d+)/i, 47],
    [/block value .* by (\d+)/i, 48]
  ];

  for (const [pattern, type] of ratingPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) setStat(stats, type, Number(match[1]));
  }

  const itemLevel = Number(text.match(/Item Level\s+(\d+)/i)?.[1] ?? 0);
  if (!itemLevel) return null;

  return {
    itemLevel,
    requiredLevel: Number(text.match(/Requires Level\s+(\d+)/i)?.[1] ?? 0),
    armor: Number(text.match(/(\d+)\s+Armor\b/i)?.[1] ?? 0),
    damageMin: Number(
      text.match(/(\d+)\s*-\s*\d+\s+\S*\s*Damage\b/i)?.[1] ?? 0
    ),
    damageMax: Number(
      text.match(/\d+\s*-\s*(\d+)\s+\S*\s*Damage\b/i)?.[1] ?? 0
    ),
    stats
  };
}

export async function getExilItemReference(itemId: number) {
  return cacheJson(`exil:item-reference:${itemId}:v2`, 86400, async () => {
    const response = await fetch(`https://db.exil.es/item/${itemId}`, {
      headers: {
        accept: 'text/html'
      },
      next: {
        revalidate: 86400
      }
    });

    if (!response.ok) return null;
    return parseExilItemHtml(await response.text());
  });
}
