import { describe, expect, it } from 'vitest';
import {
  defaultItemScalingLevel,
  scaleItemEntityLevel
} from '@/lib/item-scaling';
import type { GameEntitySummary } from '@/server/game-data/types';

function itemEntity(
  id: number,
  metadata: GameEntitySummary['metadata'] = {}
): GameEntitySummary {
  return {
    id,
    kind: 'items',
    slug: `items/${id}`,
    name: `Item ${id}`,
    description: null,
    category: null,
    icon: null,
    metadata,
    sourceTable: 'aowow_items'
  };
}

describe('scaleItemEntityLevel', () => {
  it('uses Reborn armor as displayed armor and preserves raw ItemArmor', () => {
    const scaled = scaleItemEntityLevel(itemEntity(5016), 60);

    expect(scaled.metadata.armor).toBe(54);
    expect(scaled.metadata.Armor).toBe(54);
    expect(scaled.metadata.armorReborn).toBe(54);
    expect(scaled.metadata.ItemArmorReborn).toBe(54);
    expect(scaled.metadata.itemArmor).toBe(226);
    expect(scaled.metadata.ItemArmor).toBe(226);
  });

  it('resolves the default level for dynamically scalable item hovers', () => {
    expect(defaultItemScalingLevel(itemEntity(5016, { itemLevel: 60 }))).toBe(
      60
    );
  });

  it('does not invent a hover scaling level without a base item level', () => {
    expect(defaultItemScalingLevel(itemEntity(5016))).toBe(0);
  });
});
