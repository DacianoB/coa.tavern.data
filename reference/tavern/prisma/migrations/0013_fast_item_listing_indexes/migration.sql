-- Non-destructive read indexes for the high-traffic item listing page.
-- These keep source AoWoW rows intact while making the common ORDER BY paths indexable.

CREATE INDEX IF NOT EXISTS aowow_items_listing_default_idx
  ON game.aowow_items (quality DESC, "itemLevel" DESC, lower(name_loc0), id);

CREATE INDEX IF NOT EXISTS aowow_items_listing_ilvl_idx
  ON game.aowow_items ("itemLevel" DESC, quality DESC, id);

CREATE INDEX IF NOT EXISTS aowow_items_listing_required_level_idx
  ON game.aowow_items ("requiredLevel" DESC, "itemLevel" DESC, id);

CREATE INDEX IF NOT EXISTS aowow_items_listing_slot_idx
  ON game.aowow_items (slot, lower(name_loc0), id);

CREATE INDEX IF NOT EXISTS aowow_items_listing_class_idx
  ON game.aowow_items (class, "subClass", lower(name_loc0), id);

CREATE INDEX IF NOT EXISTS aowow_items_listing_name_idx
  ON game.aowow_items (lower(name_loc0), id);
