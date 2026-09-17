-- Omit zero-valued interpolation fields from builder spell JSON. The renderer
-- already treats missing numeric fields as zero, so this preserves behavior
-- while reducing response bytes for large trees.

CREATE OR REPLACE FUNCTION app.builder_spell_text_payload(p_spell game.aowow_spell)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_spell IS NULL THEN NULL
    ELSE jsonb_strip_nulls(jsonb_build_object(
      'id', p_spell.id,
      'duration', NULLIF(p_spell.duration, 0),
      'baseLevel', NULLIF(p_spell."baseLevel", 0),
      'spellLevel', NULLIF(p_spell."spellLevel", 0),
      'effect1RealPointsPerLevel', NULLIF(p_spell."effect1RealPointsPerLevel", 0),
      'effect2RealPointsPerLevel', NULLIF(p_spell."effect2RealPointsPerLevel", 0),
      'effect3RealPointsPerLevel', NULLIF(p_spell."effect3RealPointsPerLevel", 0),
      'effect1DieSides', NULLIF(p_spell."effect1DieSides", 0),
      'effect2DieSides', NULLIF(p_spell."effect2DieSides", 0),
      'effect3DieSides', NULLIF(p_spell."effect3DieSides", 0),
      'effect1BasePoints', NULLIF(p_spell."effect1BasePoints", 0),
      'effect2BasePoints', NULLIF(p_spell."effect2BasePoints", 0),
      'effect3BasePoints', NULLIF(p_spell."effect3BasePoints", 0),
      'effect1RadiusMin', NULLIF(p_spell."effect1RadiusMin", 0),
      'effect2RadiusMin', NULLIF(p_spell."effect2RadiusMin", 0),
      'effect3RadiusMin', NULLIF(p_spell."effect3RadiusMin", 0),
      'effect1RadiusMax', NULLIF(p_spell."effect1RadiusMax", 0),
      'effect2RadiusMax', NULLIF(p_spell."effect2RadiusMax", 0),
      'effect3RadiusMax', NULLIF(p_spell."effect3RadiusMax", 0),
      'effect1Periode', NULLIF(p_spell."effect1Periode", 0),
      'effect2Periode', NULLIF(p_spell."effect2Periode", 0),
      'effect3Periode', NULLIF(p_spell."effect3Periode", 0),
      'effect1PointsPerComboPoint', NULLIF(p_spell."effect1PointsPerComboPoint", 0),
      'effect2PointsPerComboPoint', NULLIF(p_spell."effect2PointsPerComboPoint", 0),
      'effect3PointsPerComboPoint', NULLIF(p_spell."effect3PointsPerComboPoint", 0),
      'effect1ValueMultiplier', NULLIF(p_spell."effect1ValueMultiplier", 0),
      'effect2ValueMultiplier', NULLIF(p_spell."effect2ValueMultiplier", 0),
      'effect3ValueMultiplier', NULLIF(p_spell."effect3ValueMultiplier", 0),
      'effect1DamageMultiplier', NULLIF(p_spell."effect1DamageMultiplier", 0),
      'effect2DamageMultiplier', NULLIF(p_spell."effect2DamageMultiplier", 0),
      'effect3DamageMultiplier', NULLIF(p_spell."effect3DamageMultiplier", 0),
      'procChance', NULLIF(p_spell."procChance", 0),
      'maxAffectedTargets', NULLIF(p_spell."maxAffectedTargets", 0),
      'procCharges', NULLIF(p_spell."procCharges", 0),
      'effect1MiscValue', NULLIF(p_spell."effect1MiscValue", 0),
      'effect2MiscValue', NULLIF(p_spell."effect2MiscValue", 0),
      'effect3MiscValue', NULLIF(p_spell."effect3MiscValue", 0),
      'stackAmount', NULLIF(p_spell."stackAmount", 0),
      'maxTargetLevel', NULLIF(p_spell."maxTargetLevel", 0),
      'effect1ChainTarget', NULLIF(p_spell."effect1ChainTarget", 0),
      'effect2ChainTarget', NULLIF(p_spell."effect2ChainTarget", 0),
      'effect3ChainTarget', NULLIF(p_spell."effect3ChainTarget", 0)
    ))
  END;
$$;
