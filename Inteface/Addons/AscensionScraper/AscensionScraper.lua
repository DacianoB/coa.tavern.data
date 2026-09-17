local ADDON_NAME = "AscensionScraper"

local DB
local frame = CreateFrame("Frame")
local tooltip = CreateFrame("GameTooltip", "AscensionScraperTooltip", UIParent, "GameTooltipTemplate")
tooltip:SetOwner(UIParent, "ANCHOR_NONE")

local DEFAULTS = {
  itemStart = 1,
  itemEnd = 999999,
  spellStart = 1,
  spellEnd = 999999,
  itemBatch = 10,
  knownItemBatch = 25,
  spellBatch = 100,
  interval = 0.05,
  maxFrameMs = 4,
  pendingTimeout = 8,
  showProgress = true,
  storeTooltips = true,
  itemInstantProbe = false,
  itemGapSkip = false,
  itemGapMaxSkip = 50,
  itemGapBacktrack = 60,
  pauseInCombat = true,
  reloadGuard = true,
}

local session = {
  active = false,
  kind = nil,
  cursor = 1,
  finish = 1,
  batch = 1,
  elapsed = 0,
  scanned = 0,
  found = 0,
  queued = 0,
  startedAt = 0,
  startedCursor = 1,
  lastPrint = 0,
  lastUiUpdate = 0,
  itemGapSkipStep = 1,
  itemGapDenseUntil = 0,
  pendingDrainStartedAt = nil,
  list = nil,
}

local pendingItems = {}
local pendingOrder = {}
local MAX_PENDING_ITEMS = 0
local progressFrame
local progressBar
local progressText
local progressDetailText
local mainFrame
local mainStatusText
local mainFields = {}
local mainChecks = {}
local StopScan
local UpdateMainFrame
local allowAddonReload = false
local originalReloadUI = ReloadUI

local function Print(message)
  DEFAULT_CHAT_FRAME:AddMessage("|cff66ddffAscensionScraper:|r " .. tostring(message))
end

local function InstallReloadGuard()
  if not originalReloadUI then
    return
  end

  if not DB or not DB.config or not DB.config.reloadGuard then
    if _G.AscensionScraperReloadGuardInstalled and _G.AscensionScraperOriginalReloadUI then
      ReloadUI = _G.AscensionScraperOriginalReloadUI
      _G.AscensionScraperReloadGuardInstalled = nil
    end
    return
  end

  if _G.AscensionScraperReloadGuardInstalled then
    return
  end

  _G.AscensionScraperOriginalReloadUI = originalReloadUI
  _G.AscensionScraperReloadGuardInstalled = true
  ReloadUI = function(...)
    if allowAddonReload then
      return originalReloadUI(...)
    end

    Print("Blocked an unexpected ReloadUI call. Use /scrap save for an intentional save/reload, or /scrap reloadguard off to allow reloads.")
  end
end

local function RequestReloadUI()
  allowAddonReload = true
  if originalReloadUI then
    originalReloadUI()
  end
end

local function CountKeys(value)
  local count = 0
  for _ in pairs(value or {}) do
    count = count + 1
  end
  return count
end

local function MergeKeyedTable(target, source)
  if type(source) ~= "table" then
    return 0
  end

  local count = 0
  for key, value in pairs(source) do
    target[key] = value
    count = count + 1
  end
  return count
end

local function SafeCall(func, ...)
  if not func then
    return nil
  end

  local values = { pcall(func, ...) }
  if not values[1] then
    return nil
  end

  table.remove(values, 1)
  return unpack(values)
end

local function PackReturns(...)
  local packed = { n = select("#", ...) }
  for index = 1, packed.n do
    packed[index] = select(index, ...)
  end
  return packed
end

local function SafePack(func, ...)
  if not func then
    return { n = 0 }
  end

  local values = PackReturns(pcall(func, ...))
  if not values[1] then
    return { n = 0, error = values[2] }
  end

  local result = { n = values.n - 1 }
  for index = 2, values.n do
    result[index - 1] = values[index]
  end
  return result
end

local function GetMs()
  if debugprofilestop then
    return debugprofilestop()
  end
  return GetTime() * 1000
end

local function FormatDuration(seconds)
  seconds = math.max(0, math.floor(seconds or 0))
  local hours = math.floor(seconds / 3600)
  local minutes = math.floor((seconds % 3600) / 60)
  local secs = seconds % 60

  if hours > 0 then
    return hours .. "h " .. minutes .. "m"
  end
  if minutes > 0 then
    return minutes .. "m " .. secs .. "s"
  end
  return secs .. "s"
end

local function CopyDefaults(target, defaults)
  for key, value in pairs(defaults) do
    if target[key] == nil then
      target[key] = value
    end
  end
end

local function MigrateNumberedStringKeys(value)
  if type(value) ~= "table" then
    return
  end

  local keys = {}
  for key in pairs(value) do
    local number = type(key) == "string" and tonumber(key)
    if number and number >= 1 and math.floor(number) == number then
      keys[#keys + 1] = { key = key, number = number }
    end
  end

  table.sort(keys, function(left, right)
    return left.number < right.number
  end)

  for index = 1, #keys do
    local key = keys[index].key
    local number = keys[index].number
    if value[number] == nil then
      value[number] = value[key]
    end
    value[key] = nil
  end
end

local function MigrateTrainerRecordArrays(record)
  if type(record) ~= "table" then
    return
  end

  record.rankIndex = tonumber(record.rankIndex) or record.rankIndex

  MigrateNumberedStringKeys(record.spell_required)
  MigrateNumberedStringKeys(record.spellRequiredIds)
  MigrateNumberedStringKeys(record.spellRequiredNames)
  MigrateNumberedStringKeys(record.abilityReqs)

  if type(record.abilityReqs) == "table" then
    for _, requirement in pairs(record.abilityReqs) do
      if type(requirement) == "table" then
        MigrateNumberedStringKeys(requirement.resolvedSpellIds)
      end
    end
  end
end

local function MigrateTrainerServiceArrays()
  if type(DB) ~= "table" then
    return
  end

  for _, service in pairs(DB.trainerServices or {}) do
    if type(service) == "table" and type(service.ranks) == "table" then
      MigrateNumberedStringKeys(service.ranks)
      for _, record in pairs(service.ranks) do
        MigrateTrainerRecordArrays(record)
      end
    end
  end

  for _, spell in pairs(DB.spells or {}) do
    if type(spell) == "table" then
      MigrateNumberedStringKeys(spell.spell_required)
      MigrateNumberedStringKeys(spell.spell_required_names)
      MigrateNumberedStringKeys(spell.trainerAbilityReqs)
      MigrateTrainerRecordArrays(spell.trainer)
    end
  end
end

local function EnsureDB()
  AscensionScraperDB = AscensionScraperDB or {}
  DB = AscensionScraperDB

  local previousSchemaVersion = tonumber(DB.schemaVersion) or 0
  DB.version = DB.version or 1
  DB.schemaVersion = 12
  DB.createdAt = DB.createdAt or time()
  DB.updatedAt = DB.updatedAt or time()
  DB.config = DB.config or {}
  CopyDefaults(DB.config, DEFAULTS)
  if previousSchemaVersion < 11 then
    DB.config.itemEnd = math.max(tonumber(DB.config.itemEnd) or 0, DEFAULTS.itemEnd)
    DB.config.spellEnd = math.max(tonumber(DB.config.spellEnd) or 0, DEFAULTS.spellEnd)
    DB.config.itemGapSkip = false
    DB.config.itemInstantProbe = false
  end
  DB.config.itemGapMaxSkip = math.floor(tonumber(DB.config.itemGapMaxSkip) or DEFAULTS.itemGapMaxSkip)
  if DB.config.itemGapMaxSkip < 1 then
    DB.config.itemGapMaxSkip = 1
  end
  DB.config.itemGapBacktrack = math.floor(tonumber(DB.config.itemGapBacktrack) or DEFAULTS.itemGapBacktrack)
  if DB.config.itemGapBacktrack < 0 then
    DB.config.itemGapBacktrack = 0
  end
  InstallReloadGuard()

  DB.items = DB.items or {}
  DB.spells = DB.spells or {}
  DB.spellbook = DB.spellbook or {}
  DB.trainerServices = DB.trainerServices or {}
  MigrateTrainerServiceArrays()

  DB.progress = DB.progress or {}
  DB.progress.items = DB.progress.items or {}
  DB.progress.knownItems = DB.progress.knownItems or {}
  DB.progress.spells = DB.progress.spells or {}
  DB.export = DB.export or {}
  DB.export.format = "AscensionScraperDB"
  DB.export.savedVariables = "WTF/Account/<ACCOUNT>/SavedVariables/AscensionScraper.lua"
  DB.export.coaTavernImporter = "pnpm game:import-scraper"
  DB.export.targetSchema = "game"
  DB.export.targetTables = "aowow_items,aowow_spell"
  DB.export.schemaPolicy = "update existing columns only; no game schema migration"

  CopyDefaults(DB.progress.items, {
    nextId = DB.config.itemStart,
    startId = DB.config.itemStart,
    endId = DB.config.itemEnd,
    scanned = 0,
    found = 0,
    queued = 0,
    complete = false,
  })
  if previousSchemaVersion < 11 then
    DB.progress.items.endId = math.max(tonumber(DB.progress.items.endId) or 0, DB.config.itemEnd)
  end

  CopyDefaults(DB.progress.knownItems, {
    nextId = 1,
    nextOffset = 1,
    startId = 1,
    endId = 0,
    scanned = 0,
    found = 0,
    queued = 0,
    complete = false,
  })

  CopyDefaults(DB.progress.spells, {
    nextId = DB.config.spellStart,
    startId = DB.config.spellStart,
    endId = DB.config.spellEnd,
    scanned = 0,
    found = 0,
    complete = false,
  })
  if previousSchemaVersion < 11 then
    DB.progress.spells.endId = math.max(tonumber(DB.progress.spells.endId) or 0, DB.config.spellEnd)
  end
end

local function MergeImportDB()
  if type(AscensionScraperImportDB) ~= "table" or AscensionScraperImportDB.__merged then
    return false
  end

  EnsureDB()

  local importedItems = MergeKeyedTable(DB.items, AscensionScraperImportDB.items)
  local importedSpells = MergeKeyedTable(DB.spells, AscensionScraperImportDB.spells)
  local importedSpellbook = MergeKeyedTable(DB.spellbook, AscensionScraperImportDB.spellbook)
  local importedTrainer = MergeKeyedTable(DB.trainerServices, AscensionScraperImportDB.trainerServices)

  if type(AscensionScraperImportDB.config) == "table" then
    CopyDefaults(DB.config, AscensionScraperImportDB.config)
  end

  DB.importedAt = time()
  DB.updatedAt = time()
  AscensionScraperImportDB.__merged = true

  Print("Imported addon data: spells " .. importedSpells .. ", items " .. importedItems .. ", spellbook " .. importedSpellbook .. ", trainer " .. importedTrainer .. ". Use /scrap save to persist.")
  return true
end

local function DebugImport()
  local importType = type(AscensionScraperImportDB)
  Print("Import variable type: " .. importType .. ".")

  if importType == "table" then
    Print("Import counts: spells " .. CountKeys(AscensionScraperImportDB.spells) .. ", items " .. CountKeys(AscensionScraperImportDB.items) .. ", spellbook " .. CountKeys(AscensionScraperImportDB.spellbook) .. ", trainer " .. CountKeys(AscensionScraperImportDB.trainerServices) .. ".")
  else
    Print("AscensionScraperImportDB is missing. Import.lua is not loaded, has a syntax error, or uses the wrong variable name.")
  end

  Print("Live counts: spells " .. CountKeys(DB and DB.spells) .. ", items " .. CountKeys(DB and DB.items) .. ", spellbook " .. CountKeys(DB and DB.spellbook) .. ", trainer " .. CountKeys(DB and DB.trainerServices) .. ".")
end

local function ClampNumber(value, fallback, minimum)
  local number = tonumber(value)
  if not number then
    number = fallback
  end
  number = math.floor(number)
  if minimum and number < minimum then
    return minimum
  end
  return number
end

local function ColorByte(value)
  value = tonumber(value) or 0
  if value < 0 then
    value = 0
  elseif value > 1 then
    value = 1
  end

  return math.floor((value * 255) + 0.5)
end

local function ColorHex(r, g, b, a)
  return string.format(
    "%02x%02x%02x%02x",
    ColorByte(a == nil and 1 or a),
    ColorByte(r),
    ColorByte(g),
    ColorByte(b)
  )
end

local function ReadFontStringStyle(fontString)
  if not fontString then
    return nil
  end

  local style = {}

  if fontString.GetTextColor then
    local r, g, b, a = fontString:GetTextColor()
    style.color = { r, g, b, a }
    style.colorHex = ColorHex(r, g, b, a)
  end

  if fontString.GetFont then
    local font, size, flags = fontString:GetFont()
    style.font = font
    style.fontSize = size
    style.fontFlags = flags
  end

  if fontString.GetJustifyH then
    style.justifyH = fontString:GetJustifyH()
  end

  if fontString.GetJustifyV then
    style.justifyV = fontString:GetJustifyV()
  end

  if fontString.GetShadowOffset then
    local x, y = fontString:GetShadowOffset()
    style.shadowOffset = { x, y }
  end

  if fontString.GetShadowColor then
    local r, g, b, a = fontString:GetShadowColor()
    style.shadowColor = { r, g, b, a }
    style.shadowColorHex = ColorHex(r, g, b, a)
  end

  if next(style) then
    return style
  end

  return nil
end

local function ReadTooltipData()
  local lines = {}
  for i = 1, tooltip:NumLines() do
    local left = _G["AscensionScraperTooltipTextLeft" .. i]
    local right = _G["AscensionScraperTooltipTextRight" .. i]
    local leftText = left and left:GetText()
    local rightText = right and right:GetText()
    local line

    if leftText and rightText and rightText ~= "" then
      line = leftText .. "\t" .. rightText
    elseif leftText and leftText ~= "" then
      line = leftText
    end

    if line then
      local entry = {
        left = leftText,
        right = rightText,
        text = line,
      }

      if left and left.GetTextColor then
        local r, g, b, a = left:GetTextColor()
        entry.leftColor = { r, g, b, a }
        entry.leftColorHex = ColorHex(r, g, b, a)
      end

      if right and right.GetTextColor then
        local r, g, b, a = right:GetTextColor()
        entry.rightColor = { r, g, b, a }
        entry.rightColorHex = ColorHex(r, g, b, a)
      end

      entry.leftStyle = ReadFontStringStyle(left)
      entry.rightStyle = ReadFontStringStyle(right)

      lines[#lines + 1] = entry
    end
  end

  if #lines == 0 then
    return nil, nil
  end

  local text = {}
  for i = 1, #lines do
    text[#text + 1] = lines[i].text
  end

  return table.concat(text, "\n"), lines
end

local function CaptureTooltipWith(setter)
  tooltip:SetOwner(UIParent, "ANCHOR_NONE")
  tooltip:ClearLines()

  local originalIsShiftKeyDown = _G.IsShiftKeyDown
  local originalIsModifierKeyDown = _G.IsModifierKeyDown
  _G.IsShiftKeyDown = function()
    return 1
  end
  _G.IsModifierKeyDown = function()
    return 1
  end

  local ok = pcall(setter)
  _G.IsShiftKeyDown = originalIsShiftKeyDown
  _G.IsModifierKeyDown = originalIsModifierKeyDown

  if ok and tooltip:NumLines() > 0 then
    return ReadTooltipData()
  end

  return nil, nil
end

local function CaptureItemTooltip(id, itemLink, itemString)
  local text, lines

  if itemLink then
    text, lines = CaptureTooltipWith(function()
      tooltip:SetHyperlink(itemLink)
    end)
  end

  if not text and itemString then
    text, lines = CaptureTooltipWith(function()
      tooltip:SetHyperlink(itemString)
    end)
  end

  if text then
    return text, lines
  end

  return CaptureTooltipWith(function()
    tooltip:SetHyperlink("item:" .. id)
  end)
end

local function NormalizeInstantItem(rawItem, instantType, instantSubType, instantEquipLoc, instantIcon, instantClassId, instantSubClassId)
  if type(rawItem) == "table" then
    return {
      itemId = rawItem.itemID or rawItem.itemId or rawItem.id,
      name = rawItem.name,
      itemType = rawItem.itemType or rawItem.type or instantType,
      itemSubType = rawItem.itemSubType or rawItem.subType or instantSubType,
      equipLoc = rawItem.equipLoc or rawItem.inventoryType or instantEquipLoc,
      icon = rawItem.icon or instantIcon,
      classId = rawItem.classID or rawItem.classId or instantClassId,
      subClassId = rawItem.subclassID or rawItem.subClassId or instantSubClassId,
      quality = rawItem.quality,
      itemLevel = rawItem.itemLevel,
      description = rawItem.description,
      pvePower = rawItem.pvePower,
      pvpPower = rawItem.pvpPower,
      inventoryType = rawItem.inventoryType,
      miscValue = rawItem.miscValue,
    }
  end

  return rawItem and {
    itemId = rawItem,
    itemType = instantType,
    itemSubType = instantSubType,
    equipLoc = instantEquipLoc,
    icon = instantIcon,
    classId = instantClassId,
    subClassId = instantSubClassId,
  } or nil
end

local function CaptureSpellTooltip(id, spellBookIndex)
  local text, lines = CaptureTooltipWith(function()
    tooltip:SetHyperlink("spell:" .. id)
  end)

  if not text then
    local link = SafeCall(GetSpellLink, id)
    if link then
      text, lines = CaptureTooltipWith(function()
        tooltip:SetHyperlink(link)
      end)
    end
  end

  if not text and tooltip.SetSpellByID then
    text, lines = CaptureTooltipWith(function()
      tooltip:SetSpellByID(id)
    end)
  end

  if not text and spellBookIndex and tooltip.SetSpellBookItem then
    text, lines = CaptureTooltipWith(function()
      tooltip:SetSpellBookItem(spellBookIndex, BOOKTYPE_SPELL or "spell")
    end)
  end

  return text, lines
end

local function CaptureTrainerTooltip(index)
  if not tooltip.SetTrainerService then
    return nil, nil
  end

  return CaptureTooltipWith(function()
    tooltip:SetTrainerService(index)
  end)
end

local function ParseSpellTooltip(lines)
  if not lines then
    return {}
  end

  local parsed = {
    requirements = {},
    effectLines = {},
  }

  local function Push(list, value)
    if value and value ~= "" then
      list[#list + 1] = value
    end
  end

  for i = 1, #lines do
    local classified = false
    local fullText = lines[i].text or ""
    local parts = { lines[i].left, lines[i].right }
    local isMechanicLine = i <= 5

    for partIndex = 1, #parts do
      local text = parts[partIndex]
      if text and text ~= "" then
        local lower = string.lower(text)
        local level = text:match("[Rr]equires [Ll]evel (%d+)")

        if level and not parsed.requiredLevel then
          parsed.requiredLevel = tonumber(level)
        end

        if string.find(lower, "requires", 1, true) or string.find(lower, "classes:", 1, true) or string.find(lower, "class:", 1, true) then
          Push(parsed.requirements, text)
          classified = true

          local classText = text:match("[Cc]lasses?:%s*(.+)") or text:match("[Rr]equires%s+(.+)")
          if classText then
            local classLower = string.lower(classText)
            if not string.find(classLower, "level", 1, true)
              and not string.find(classLower, "item", 1, true)
              and not string.find(classLower, "weapon", 1, true)
              and not string.find(classLower, "skill", 1, true) then
              parsed.requiredClassText = parsed.requiredClassText or classText
            end
          end
        elseif isMechanicLine and (string.find(lower, "mana", 1, true)
          or string.find(lower, "rage", 1, true)
          or string.find(lower, "energy", 1, true)
          or string.find(lower, "focus", 1, true)
          or string.find(lower, "runic power", 1, true)) then
          parsed.powerText = parsed.powerText or text
          classified = true
        elseif isMechanicLine and (string.find(lower, "range", 1, true) or string.find(lower, "yd", 1, true)) then
          parsed.rangeText = parsed.rangeText or text
          classified = true
        elseif isMechanicLine and (string.find(lower, "cast", 1, true) or lower == "instant" or string.find(lower, "channeled", 1, true)) then
          parsed.castText = parsed.castText or text
          classified = true
        elseif isMechanicLine and string.find(lower, "cooldown", 1, true) then
          parsed.cooldownText = parsed.cooldownText or text
          classified = true
        end
      end
    end

    if i > 1 and fullText ~= "" and not classified then
      Push(parsed.effectLines, fullText)
    end
  end

  if #parsed.requirements == 0 then
    parsed.requirements = nil
  end

  if #parsed.effectLines > 0 then
    parsed.description = table.concat(parsed.effectLines, "\n")
  else
    parsed.effectLines = nil
  end

  return parsed
end

local function ExtractSpellIdFromLink(link)
  if not link then
    return nil
  end

  return tonumber(string.match(link, "spell:(%d+)"))
end

local function ExtractSpellIdFromTooltip(lines)
  if not lines then
    return nil
  end

  for i = #lines, 1, -1 do
    local text = lines[i].left or lines[i].text
    if text then
      local id = tonumber(string.match(text, "^[Ii][Dd]%s+(%d+)$")) or tonumber(string.match(text, "[Ii][Dd]%s+(%d+)"))
      if id then
        return id
      end
    end
  end

  return nil
end

local function ExtractItemString(link)
  if not link then
    return nil
  end

  return string.match(link, "|H(item:[^|]+)|h")
end

local POWER_TYPE_NAMES = {
  [0] = "mana",
  [1] = "rage",
  [2] = "focus",
  [3] = "energy",
  [4] = "happiness",
  [5] = "runes",
  [6] = "runic_power",
  [7] = "soul_shards",
  [8] = "eclipse",
  [9] = "holy_power",
  [10] = "alternate",
}

local SCHOOL_MASK_NAMES = {
  [1] = "Physical",
  [2] = "Holy",
  [4] = "Fire",
  [8] = "Nature",
  [16] = "Frost",
  [32] = "Shadow",
  [64] = "Arcane",
}

local SCHOOL_EXACT_NAMES = {
  [3] = "Holystrike",
  [5] = "Flamestrike",
  [6] = "Holyfire",
  [9] = "Stormstrike",
  [10] = "Holystorm",
  [12] = "Firestorm",
  [17] = "Froststrike",
  [18] = "Holyfrost",
  [20] = "Frostfire",
  [24] = "Froststorm",
  [33] = "Shadowstrike",
  [34] = "Twilight",
  [36] = "Shadowflame",
  [40] = "Plague",
  [48] = "Shadowfrost",
  [65] = "Spellstrike",
  [66] = "Divine",
  [68] = "Spellfire",
  [72] = "Spellstorm",
  [80] = "Spellfrost",
  [96] = "Spellshadow",
  [126] = "Chaos",
  [127] = "Chromatic",
}

local SCHOOL_NAME_MASKS = {
  physical = 1,
  holy = 2,
  fire = 4,
  nature = 8,
  frost = 16,
  shadow = 32,
  arcane = 64,
}

local SCHOOL_SCAN_ORDER = {
  "Physical",
  "Holy",
  "Fire",
  "Nature",
  "Frost",
  "Shadow",
  "Arcane",
}

local function GetPowerTypeName(powerType)
  if powerType == nil or powerType == false then
    return nil
  end

  return POWER_TYPE_NAMES[powerType] or ("power_" .. tostring(powerType))
end

local function AddUniqueSchool(result, name)
  local mask = name and SCHOOL_NAME_MASKS[string.lower(name)]
  if not mask or result.seen[mask] then
    return
  end

  result.seen[mask] = true
  result.names[#result.names + 1] = SCHOOL_MASK_NAMES[mask]
  result.mask = result.mask + mask
end

local function GetSchoolTextFromMask(mask)
  if type(mask) ~= "number" then
    return nil
  end

  local apiText = SafeCall(GetSchoolString, mask)
  if apiText then
    return apiText
  end

  if SCHOOL_EXACT_NAMES[mask] then
    return SCHOOL_EXACT_NAMES[mask]
  end

  local names = {}
  for _, name in ipairs(SCHOOL_SCAN_ORDER) do
    local schoolMask = SCHOOL_NAME_MASKS[string.lower(name)]
    if math.floor(mask / schoolMask) % 2 == 1 then
      names[#names + 1] = name
    end
  end

  if #names > 0 then
    return table.concat(names, ", ")
  end

  return nil
end

local function GetSchoolMaskFromText(text)
  if type(text) ~= "string" then
    return nil
  end

  return SCHOOL_NAME_MASKS[string.lower(text)]
end

local function NormalizeApiSpellSchool(value)
  if type(value) == "number" then
    return value, GetSchoolTextFromMask(value)
  end

  if type(value) == "string" and value ~= "" then
    return GetSchoolMaskFromText(value), value
  end

  return nil, nil
end

local function ExtractSpellSchoolFromTooltip(lines)
  if not lines then
    return nil, nil, nil
  end

  local result = {
    names = {},
    mask = 0,
    seen = {},
  }

  for i = 1, #lines do
    local text = (lines[i].text or "") .. " " .. (lines[i].left or "") .. " " .. (lines[i].right or "")
    for school in string.gmatch(text, "([A-Za-z]+)%s+[Dd]amage") do
      AddUniqueSchool(result, school)
    end
    for school in string.gmatch(text, "([A-Za-z]+)%s+[Rr]esistance") do
      AddUniqueSchool(result, school)
    end
  end

  if #result.names == 0 then
    return nil, nil, nil
  end

  return result.names[1], result.mask, result.names
end

local function NormalizeRange(value)
  if value == nil or value == false then
    return 0
  end

  return value
end

local function NormalizeCooldown(baseCooldown, gcdCooldown)
  baseCooldown = tonumber(baseCooldown)
  gcdCooldown = tonumber(gcdCooldown)

  if baseCooldown and gcdCooldown and baseCooldown == 0 and gcdCooldown == 0 then
    return false
  end

  if baseCooldown and baseCooldown > 0 then
    if gcdCooldown and gcdCooldown > 0 and baseCooldown <= gcdCooldown then
      return 0
    end
    return baseCooldown
  end

  return 0
end

local function NormalizeText(value)
  value = tostring(value or "")
  value = string.lower(value)
  value = string.gsub(value, "^%s+", "")
  value = string.gsub(value, "%s+$", "")
  return value
end

local function ParseNameRank(text, fallbackRank)
  local name = text
  local rank = fallbackRank

  if type(text) == "string" then
    local parsedName, parsedRank = string.match(text, "^(.-)%s+%((Rank%s+%d+)%)$")
    if parsedName and parsedRank then
      name = parsedName
      rank = parsedRank
    end
  end

  return name, rank
end

local function OrderedListInsert(list, value)
  if value == nil then
    return
  end

  list[#list + 1] = value
end

local function ArrayToOrderedList(values)
  if type(values) ~= "table" or #values == 0 then
    return nil
  end

  local ordered = {}
  for index = 1, #values do
    ordered[index] = values[index]
  end
  return ordered
end

local function PackToNamedTable(packed, names)
  if not packed or not packed.n or packed.n == 0 then
    return nil
  end

  local result = {}
  for index = 1, packed.n do
    local key = names and names[index] or ("value" .. index)
    result[key] = packed[index]
  end
  return result
end

local function ExtractRankNumber(rank)
  return tonumber(string.match(tostring(rank or ""), "(%d+)")) or 1
end

local function BuildTrainerRequirementList(abilityNames, skillRequirement, stepRequirement, skillLine)
  local requirements = {}

  if type(abilityNames) == "table" then
    for index = 1, #abilityNames do
      local value = abilityNames[index]
      if value then
        OrderedListInsert(requirements, value)
      end
    end
  end

  if type(skillRequirement) == "table" then
    local required = skillRequirement.required
    local name = skillRequirement.name or skillLine
    if name and required then
      OrderedListInsert(requirements, tostring(name) .. " " .. tostring(required))
    end
  end

  if type(stepRequirement) == "table" then
    if stepRequirement.step then
      OrderedListInsert(requirements, "Step " .. tostring(stepRequirement.step))
    elseif stepRequirement.required then
      OrderedListInsert(requirements, "Step " .. tostring(stepRequirement.required))
    end
  end

  return #requirements > 0 and requirements or nil
end

local function ResolveSpellIdsByNameRank(name, rank)
  local ids = {}
  local normalizedName = NormalizeText(name)
  local normalizedRank = NormalizeText(rank)

  if normalizedName == "" or not DB or not DB.spells then
    return ids
  end

  for spellId, record in pairs(DB.spells) do
    if NormalizeText(record.name) == normalizedName then
      local recordRank = NormalizeText(record.rank)
      if normalizedRank == "" or recordRank == "" or recordRank == normalizedRank then
        ids[#ids + 1] = tonumber(spellId) or spellId
      end
    end
  end

  return ids
end

local function FirstValue(packed)
  if packed and packed.n and packed.n > 0 then
    return packed[1]
  end
  return nil
end

local function CreateProgressFrame()
  if progressFrame then
    return
  end

  progressFrame = CreateFrame("Frame", "AscensionScraperProgressFrame", UIParent)
  progressFrame:SetWidth(360)
  progressFrame:SetHeight(78)
  progressFrame:SetPoint("CENTER", UIParent, "CENTER", 0, 180)
  progressFrame:SetMovable(true)
  progressFrame:EnableMouse(true)
  progressFrame:RegisterForDrag("LeftButton")
  progressFrame:SetScript("OnDragStart", function(self)
    self:StartMoving()
  end)
  progressFrame:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
  end)

  if progressFrame.SetBackdrop then
    progressFrame:SetBackdrop({
      bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
      edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
      tile = true,
      tileSize = 32,
      edgeSize = 24,
      insets = { left = 6, right = 6, top = 6, bottom = 6 },
    })
  end

  progressText = progressFrame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  progressText:SetPoint("TOP", progressFrame, "TOP", 0, -12)
  progressText:SetText("AscensionScraper")

  progressBar = CreateFrame("StatusBar", nil, progressFrame)
  progressBar:SetWidth(310)
  progressBar:SetHeight(16)
  progressBar:SetPoint("TOP", progressText, "BOTTOM", 0, -10)
  progressBar:SetStatusBarTexture("Interface\\TargetingFrame\\UI-StatusBar")
  progressBar:SetStatusBarColor(0.25, 0.65, 1.0)
  progressBar:SetMinMaxValues(0, 1)
  progressBar:SetValue(0)

  local barBg = progressBar:CreateTexture(nil, "BACKGROUND")
  barBg:SetAllPoints(progressBar)
  barBg:SetTexture("Interface\\TargetingFrame\\UI-StatusBar")
  barBg:SetVertexColor(0.08, 0.08, 0.1, 0.85)

  progressDetailText = progressFrame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  progressDetailText:SetPoint("TOP", progressBar, "BOTTOM", 0, -8)
  progressDetailText:SetText("Idle")

  local stopButton = CreateFrame("Button", nil, progressFrame, "UIPanelButtonTemplate")
  stopButton:SetWidth(54)
  stopButton:SetHeight(20)
  stopButton:SetPoint("RIGHT", progressBar, "RIGHT", 0, 0)
  stopButton:SetText("Stop")
  stopButton:SetScript("OnClick", function()
    StopScan("Stopped.")
  end)

  progressFrame:Hide()
end

local function UpdateProgressFrame(force)
  if not DB or not DB.config.showProgress then
    if progressFrame then
      progressFrame:Hide()
    end
    return
  end

  CreateProgressFrame()

  if not session.active then
    if force then
      progressText:SetText("AscensionScraper")
      progressBar:SetMinMaxValues(0, 1)
      progressBar:SetValue(0)
      progressDetailText:SetText("Idle")
      progressFrame:Show()
    end
    return
  end

  local progress = DB.progress[session.kind]
  local total = math.max(1, session.finish - session.cursor + 1)
  local done = math.max(0, session.cursor - (progress.startId or session.cursor))
  local full = math.max(1, session.finish - (progress.startId or session.cursor) + 1)
  local percent = math.floor((done / full) * 10000) / 100
  local found = (progress.found or 0) + session.found
  local elapsed = math.max(0.001, GetTime() - session.startedAt)
  local runDone = math.max(0, session.cursor - session.startedCursor)
  local rate = runDone / elapsed
  local eta = rate > 0 and FormatDuration(total / rate) or "..."

  progressBar:SetMinMaxValues(0, full)
  progressBar:SetValue(done)
  progressText:SetText("Scraping " .. session.kind .. " - " .. percent .. "%")
  progressDetailText:SetText("ID " .. session.cursor .. " / " .. session.finish .. " | " .. math.floor(rate) .. "/sec | ETA " .. eta .. " | found " .. found .. " | pending " .. #pendingOrder)
  progressFrame:Show()
end

local function QueueItem(id)
  if pendingItems[id] then
    return
  end

  pendingItems[id] = GetTime()
  pendingOrder[#pendingOrder + 1] = id

  if MAX_PENDING_ITEMS > 0 and #pendingOrder > MAX_PENDING_ITEMS then
    local old = table.remove(pendingOrder, 1)
    if old then
      pendingItems[old] = nil
    end
  end
end

local function RemovePendingItem(id)
  pendingItems[id] = nil
  for index = #pendingOrder, 1, -1 do
    if pendingOrder[index] == id then
      table.remove(pendingOrder, index)
      return
    end
  end
end

local function StoreSpell(id, options)
  options = options or {}

  local spellInfo = SafePack(GetSpellInfo, id)
  local name, rank, icon, resourceCost, isFunnel, resourceType, castTime, minRange, maxRange = spellInfo[1], spellInfo[2], spellInfo[3], spellInfo[4], spellInfo[5], spellInfo[6], spellInfo[7], spellInfo[8], spellInfo[9]
  local bookType = BOOKTYPE_SPELL or "spell"

  if not name and options.spellBookIndex then
    local bookName, bookRank = SafeCall(GetSpellBookItemName, options.spellBookIndex, bookType)
    name = bookName
    rank = bookRank
  end

  if not name then
    return false
  end

  local link = SafeCall(GetSpellLink, id)
  if not link and options.spellBookIndex then
    link = SafeCall(GetSpellLink, options.spellBookIndex, bookType)
  end

  local tooltipText, tooltipLines = CaptureSpellTooltip(id, options.spellBookIndex)
  local parsed = ParseSpellTooltip(tooltipLines)
  local inferredSchool, inferredSchoolMask, inferredSchoolCandidates = ExtractSpellSchoolFromTooltip(tooltipLines)
  local apiSchoolMask, apiSchoolText = NormalizeApiSpellSchool(SafeCall(GetSpellSchool, id))
  if not apiSchoolText and spellInfo.n and spellInfo.n > 9 then
    apiSchoolMask, apiSchoolText = NormalizeApiSpellSchool(spellInfo[10])
  end
  local school = apiSchoolText or inferredSchool
  local schoolMask = apiSchoolMask or inferredSchoolMask
  local schoolSource = apiSchoolText and "api" or (inferredSchool and "tooltip" or nil)
  local levelLearned = SafeCall(GetSpellLevelLearned, id)
  local apiDescription = SafeCall(GetSpellDescription, id)
  local subtext = SafeCall(GetSpellSubtext, id)
  local texture = SafeCall(GetSpellTexture, id)
  local powerCosts = SafeCall(GetSpellPowerCost, id)
  local cooldownStart, cooldownDuration, cooldownEnabled = SafeCall(GetSpellCooldown, id)
  local baseCooldown, gcdCooldown = SafeCall(GetSpellBaseCooldown, id)
  local baseDuration = SafeCall(GetSpellBaseDuration, id)
  local charges, maxCharges, chargeCooldownStart, chargeCooldownDuration = SafeCall(GetSpellCharges, id)
  local maxStack = SafeCall(GetSpellMaxStack, id)
  local isUsable, notEnoughMana = SafeCall(IsUsableSpell, id)
  local isPassive = options.isPassive
  if isPassive == nil and options.spellBookIndex then
    isPassive = SafeCall(IsPassiveSpell, options.spellBookIndex, bookType)
  end
  if isPassive == nil then
    isPassive = SafeCall(IsPassiveSpellID, id)
  end

  local record = {
    id = id,
    name = name,
    rank = rank,
    subtext = subtext,
    icon = icon,
    texture = texture,
    castTime = castTime or 0,
    minRange = NormalizeRange(minRange),
    maxRange = NormalizeRange(maxRange),
    resource = GetPowerTypeName(resourceType),
    resource_cost = resourceCost or 0,
    resource_type = resourceType,
    resourceCost = resourceCost or 0,
    resourceType = resourceType,
    isFunnel = isFunnel,
    school = school,
    school_mask = schoolMask,
    schoolMask = schoolMask,
    schoolSource = schoolSource,
    schoolCandidates = inferredSchoolCandidates,
    link = link,
    tooltip = tooltipText,
    tooltipLines = tooltipLines,
    tooltipCaptured = tooltipText ~= nil,
    tooltipForceShift = true,
    description = parsed.description or apiDescription,
    apiDescription = apiDescription,
    tooltipDescription = parsed.description,
    level_required = parsed.requiredLevel or levelLearned,
    requiredLevel = parsed.requiredLevel or levelLearned,
    levelLearned = levelLearned,
    spell_required = nil,
    requirements = parsed.requirements,
    requiredClassText = parsed.requiredClassText,
    powerText = parsed.powerText,
    rangeText = parsed.rangeText,
    castText = parsed.castText,
    cooldownText = parsed.cooldownText,
    effectLines = parsed.effectLines,
    powerCosts = powerCosts,
    cooldown = NormalizeCooldown(baseCooldown, gcdCooldown),
    baseCooldown = baseCooldown,
    gcdCooldown = gcdCooldown,
    duration = baseDuration or 0,
    baseDuration = baseDuration or 0,
    charges = charges or 0,
    maxCharges = maxCharges,
    chargeCooldown = chargeCooldownStart and {
      start = chargeCooldownStart,
      duration = chargeCooldownDuration,
    } or nil,
    maxStack = maxStack or 0,
    currentCooldown = cooldownStart and {
      start = cooldownStart,
      duration = cooldownDuration,
      enabled = cooldownEnabled,
    } or nil,
    known = SafeCall(IsSpellKnown, id),
    knownById = SafeCall(IsSpellIDKnown, id),
    caKnown = SafeCall(CA_IsSpellKnown, id),
    playerSpell = SafeCall(IsPlayerSpell, id),
    usable = isUsable,
    notEnoughMana = notEnoughMana,
    helpful = SafeCall(IsHelpfulSpell, id),
    harmful = SafeCall(IsHarmfulSpell, id),
    attackSpell = SafeCall(IsAttackSpell, id),
    passive = isPassive,
    source = options.source,
    spellBookIndex = options.spellBookIndex,
    spellBookTabName = options.spellBookTabName,
    spellBookTabIndex = options.spellBookTabIndex,
    spellBookTabTexture = options.spellBookTabTexture,
    spellBookItemType = options.spellBookItemType,
    spellBookName = options.spellBookName,
    spellBookRank = options.spellBookRank,
    capturedAt = time(),
  }

  DB.spells[id] = record
  return true
end

local function CleanTooltipItemName(value)
  if type(value) ~= "string" then
    return nil
  end

  value = string.gsub(value, "|c%x%x%x%x%x%x%x%x", "")
  value = string.gsub(value, "|r", "")
  value = string.gsub(value, "^%s+", "")
  value = string.gsub(value, "%s+$", "")

  local normalized = NormalizeText(value)
  if normalized == ""
    or string.find(normalized, "retrieving item information", 1, true)
    or string.find(normalized, "item not found", 1, true)
    or string.find(normalized, "unknown item", 1, true) then
    return nil
  end

  return value
end

local function ItemNameFromTooltip(tooltipText, tooltipLines)
  if type(tooltipLines) == "table" and type(tooltipLines[1]) == "table" then
    return CleanTooltipItemName(tooltipLines[1].left or tooltipLines[1].text)
  end

  if type(tooltipText) == "string" then
    return CleanTooltipItemName(string.match(tooltipText, "^[^\r\n]+"))
  end

  return nil
end

local function StoreItem(id, allowQueue)
  local instantItemId, instantType, instantSubType, instantEquipLoc, instantIcon, instantClassId, instantSubClassId = SafeCall(GetItemInfoInstant, id)
  local instant = NormalizeInstantItem(instantItemId, instantType, instantSubType, instantEquipLoc, instantIcon, instantClassId, instantSubClassId)

  if DB.config.itemInstantProbe and GetItemInfoInstant and not instant then
    return false, "missing"
  end

  local name, link, quality, itemLevel, requiredLevel, itemClass, itemSubClass, maxStack, equipSlot, icon, vendorPrice = GetItemInfo(id)
  local itemString = ExtractItemString(link)
  local tooltipText, tooltipLines
  if DB.config.storeTooltips or not name then
    tooltipText, tooltipLines = CaptureItemTooltip(id, link, itemString)
  end
  local tooltipName = ItemNameFromTooltip(tooltipText, tooltipLines)

  if not name and tooltipName then
    name = tooltipName
  end

  if not name then
    if allowQueue then
      QueueItem(id)
    end
    return false, allowQueue and "queued" or "missing"
  end

  local itemSpellName, itemSpellTrigger = SafeCall(GetItemSpell, link or id)
  local itemStats = SafeCall(GetItemStats, link or itemString or ("item:" .. id))

  DB.items[id] = {
    id = id,
    name = name,
    link = link,
    itemString = itemString,
    quality = quality,
    itemLevel = itemLevel,
    requiredLevel = requiredLevel,
    itemClass = itemClass,
    itemSubClass = itemSubClass,
    maxStack = maxStack,
    equipSlot = equipSlot,
    icon = icon,
    vendorPrice = vendorPrice,
    tooltip = tooltipText,
    tooltipLines = tooltipLines,
    tooltipCaptured = tooltipText ~= nil,
    tooltipForceShift = true,
    itemSpellName = itemSpellName,
    itemSpellTrigger = itemSpellTrigger,
    itemStats = itemStats,
    instant = instant,
    source = link and "api" or "tooltip",
    capturedAt = time(),
  }

  RemovePendingItem(id)
  return true
end

local function SaveProgress()
  if not session.active then
    return
  end

  local progress = DB.progress[session.kind]
  progress.nextId = session.cursor
  progress.endId = session.finish
  progress.scanned = (progress.scanned or 0) + session.scanned
  progress.found = (progress.found or 0) + session.found
  progress.queued = (progress.queued or 0) + session.queued
  progress.updatedAt = time()
  DB.updatedAt = time()

  session.scanned = 0
  session.found = 0
  session.queued = 0
end

StopScan = function(reason)
  if session.active then
    SaveProgress()
  end

  session.active = false
  session.kind = nil
  frame:SetScript("OnUpdate", nil)
  UpdateProgressFrame(true)
  if UpdateMainFrame then
    UpdateMainFrame()
  end

  if reason then
    Print(reason)
  end
end

local function CompleteScan()
  local progress = DB.progress[session.kind]
  progress.nextId = session.finish + 1
  progress.complete = true
  progress.completedAt = time()
  SaveProgress()
  StopScan("Done. Use /reload or logout so WoW writes the SavedVariables file.")
end

local function RetryPendingItems(limit)
  local checked = 0
  local now = GetTime()
  local index = 1

  while index <= #pendingOrder and checked < limit do
    local id = pendingOrder[index]
    local queuedAt = pendingItems[id]

    if not queuedAt then
      table.remove(pendingOrder, index)
    elseif now - queuedAt >= 0.75 then
      checked = checked + 1
      pendingItems[id] = nil
      table.remove(pendingOrder, index)
      StoreItem(id, false)
    else
      index = index + 1
    end
  end
end

local function IsItemScanKind(kind)
  return kind == "items" or kind == "knownItems"
end

local function DrainPendingItemsBeforeComplete()
  if not IsItemScanKind(session.kind) or #pendingOrder == 0 then
    session.pendingDrainStartedAt = nil
    return true
  end

  session.pendingDrainStartedAt = session.pendingDrainStartedAt or GetTime()
  RetryPendingItems(#pendingOrder)

  if #pendingOrder == 0 then
    session.pendingDrainStartedAt = nil
    return true
  end

  local timeout = tonumber(DB.config.pendingTimeout) or DEFAULTS.pendingTimeout
  if timeout < 0 then
    timeout = DEFAULTS.pendingTimeout
  end

  if GetTime() - session.pendingDrainStartedAt >= timeout then
    Print("Finished with " .. #pendingOrder .. " unresolved item cache misses after waiting " .. timeout .. " seconds.")
    session.pendingDrainStartedAt = nil
    return true
  end

  return false
end

local function AddKnownItemId(ids, seen, value)
  local id = tonumber(value)
  if not id then
    return
  end

  id = math.floor(id)
  if id <= 0 or seen[id] then
    return
  end

  seen[id] = true
  ids[#ids + 1] = id
end

local function KnownItemNeedsTooltip(id)
  local record = DB.items[id] or DB.items[tostring(id)]
  if type(record) ~= "table" then
    return true
  end

  if record.tooltipCaptured ~= true then
    return true
  end

  if type(record.tooltip) ~= "string" or record.tooltip == "" then
    return true
  end

  if type(record.tooltipLines) ~= "table" or #record.tooltipLines == 0 then
    return true
  end

  return false
end

local function BuildKnownItemList(mode, offset, limit)
  local source = AscensionScraperKnownItemIDs
  local chunks = AscensionScraperKnownItemIDChunks
  local ids = {}
  local seen = {}
  local startIndex = math.max(1, tonumber(offset) or 1)
  local maxCount = math.max(0, tonumber(limit) or 0)
  local sourceIndex = 0
  local sourceWindowCount = 0

  local function MaybeAddKnownId(value)
    sourceIndex = sourceIndex + 1
    if sourceIndex < startIndex then
      return
    end
    if maxCount > 0 and sourceWindowCount >= maxCount then
      return
    end
    sourceWindowCount = sourceWindowCount + 1
    AddKnownItemId(ids, seen, value)
  end

  if type(source) == "table" then
    for key, value in pairs(source) do
      if maxCount > 0 and sourceWindowCount >= maxCount then
        break
      end
      if type(value) == "number" or type(value) == "string" then
        MaybeAddKnownId(value)
      else
        MaybeAddKnownId(key)
      end
    end
  end

  if type(chunks) == "table" then
    for i = 1, #chunks do
      if maxCount > 0 and sourceWindowCount >= maxCount then
        break
      end
      local chunk = chunks[i]
      if type(chunk) == "string" then
        for value in string.gmatch(chunk, "%d+") do
          if maxCount > 0 and sourceWindowCount >= maxCount then
            break
          end
          MaybeAddKnownId(value)
        end
      end
    end
  end

  table.sort(ids)

  if mode ~= "missing" then
    return ids, sourceWindowCount
  end

  local filtered = {}
  for i = 1, #ids do
    if KnownItemNeedsTooltip(ids[i]) then
      filtered[#filtered + 1] = ids[i]
    end
  end

  return filtered, sourceWindowCount
end

local function CountKnownItemIDs()
  local declared = tonumber(AscensionScraperKnownItemIDCount)
  if declared and declared > 0 then
    return math.floor(declared)
  end

  local count = 0
  if type(AscensionScraperKnownItemIDs) == "table" then
    for _ in pairs(AscensionScraperKnownItemIDs) do
      count = count + 1
    end
  end
  if count > 0 then
    return count
  end

  if type(AscensionScraperKnownItemIDChunks) == "table" then
    for i = 1, #AscensionScraperKnownItemIDChunks do
      local chunk = AscensionScraperKnownItemIDChunks[i]
      if type(chunk) == "string" then
        for _ in string.gmatch(chunk, "%d+") do
          count = count + 1
        end
      end
    end
  end

  return count
end

local function GetKnownItemWindowInfo(mode, offset, limit)
  local scanMode = string.lower(mode or "all")
  if scanMode ~= "missing" then
    scanMode = "all"
  end

  local startOffset = ClampNumber(offset, DB and DB.progress and DB.progress.knownItems and DB.progress.knownItems.nextOffset or 1, 1)
  local scanLimit = math.max(0, tonumber(limit) or 0)
  local ids, sourceWindowCount = BuildKnownItemList(scanMode, startOffset, scanLimit)

  return {
    mode = scanMode,
    offset = startOffset,
    limit = scanLimit,
    scanCount = #ids,
    sourceWindowCount = sourceWindowCount,
    nextOffset = startOffset + sourceWindowCount,
    totalKnownIds = CountKnownItemIDs(),
  }
end

local function ShardDBName(index)
  index = ClampNumber(index, 1, 1)
  return "AscensionScraperShard" .. string.format("%03d", index) .. "DB"
end

local function ShardAddonName(index)
  index = ClampNumber(index, 1, 1)
  return "AscensionScraperShard" .. string.format("%03d", index)
end

local function FlushKnownItemChunkToShard(index, clearMain)
  EnsureDB()

  local ids = session.list
  if type(ids) ~= "table" or #ids == 0 then
    return {
      ok = false,
      reason = "No completed known-item chunk is available to shard.",
      count = 0,
    }
  end

  local dbName = ShardDBName(index)
  local addonName = ShardAddonName(index)
  if IsAddOnLoaded and not IsAddOnLoaded(addonName) and LoadAddOn then
    local ok, loaded, reason = pcall(LoadAddOn, addonName)
    if not ok or not loaded then
      return {
        ok = false,
        reason = "Could not load " .. addonName .. ": " .. tostring(reason or loaded),
        count = 0,
      }
    end
  end

  _G[dbName] = type(_G[dbName]) == "table" and _G[dbName] or {}
  local shard = _G[dbName]
  shard.version = 1
  shard.schemaVersion = DB.schemaVersion
  shard.createdAt = shard.createdAt or time()
  shard.updatedAt = time()
  shard.items = shard.items or {}
  shard.spells = shard.spells or {}
  shard.spellbook = shard.spellbook or {}
  shard.trainerServices = shard.trainerServices or {}
  shard.export = shard.export or {}
  shard.export.format = "AscensionScraperDB"
  shard.export.source = "AscensionScraperAuto"
  shard.export.targetSchema = "game"
  shard.export.targetTables = "aowow_items"
  shard.chunk = {
    shardIndex = index,
    mode = DB.progress.knownItems.mode,
    offset = DB.progress.knownItems.offset,
    nextOffset = DB.progress.knownItems.nextOffset,
    sourceCount = DB.progress.knownItems.sourceCount,
    scanned = DB.progress.knownItems.scanned,
    found = DB.progress.knownItems.found,
    completedAt = DB.progress.knownItems.completedAt,
  }

  local count = 0
  for i = 1, #ids do
    local id = tonumber(ids[i])
    local record = id and (DB.items[id] or DB.items[tostring(id)])
    if id and type(record) == "table" then
      shard.items[id] = record
      shard.items[tostring(id)] = nil
      count = count + 1
      if clearMain then
        DB.items[id] = nil
        DB.items[tostring(id)] = nil
      end
    end
  end

  DB.shards = DB.shards or {}
  DB.shards[index] = {
    dbName = dbName,
    items = count,
    offset = DB.progress.knownItems.offset,
    nextOffset = DB.progress.knownItems.nextOffset,
    savedAt = time(),
  }
  DB.updatedAt = time()

  return {
    ok = true,
    dbName = dbName,
    count = count,
  }
end

local function AdvanceScanCursor(currentId, found, state)
  if session.kind ~= "items" or not DB.config.itemGapSkip then
    session.cursor = currentId + 1
    return
  end

  local maxSkip = math.max(1, tonumber(DB.config.itemGapMaxSkip or DEFAULTS.itemGapMaxSkip) or DEFAULTS.itemGapMaxSkip)
  local backtrack = math.max(0, tonumber(DB.config.itemGapBacktrack or DEFAULTS.itemGapBacktrack) or DEFAULTS.itemGapBacktrack)
  local inDenseWindow = session.itemGapDenseUntil and currentId <= session.itemGapDenseUntil
  local itemExists = found or state == "queued"

  if itemExists then
    if not inDenseWindow and session.itemGapSkipStep and session.itemGapSkipStep > 1 and backtrack > 0 then
      session.itemGapDenseUntil = currentId + backtrack
      session.cursor = math.max(session.startedCursor or 1, currentId - backtrack)
    else
      session.itemGapDenseUntil = math.max(session.itemGapDenseUntil or 0, currentId + backtrack)
      session.cursor = currentId + 1
    end
    session.itemGapSkipStep = 1
    return
  end

  if inDenseWindow then
    session.cursor = currentId + 1
    session.itemGapSkipStep = 1
    return
  end

  local step = math.max(1, math.min(maxSkip, session.itemGapSkipStep or 1))
  session.cursor = currentId + step
  if step < maxSkip then
    session.itemGapSkipStep = step + 1
  else
    session.itemGapSkipStep = maxSkip
  end
end

local function OnUpdate(_, elapsed)
  if not session.active then
    return
  end

  if DB.config.pauseInCombat and InCombatLockdown and InCombatLockdown() then
    return
  end

  session.elapsed = session.elapsed + elapsed
  if session.elapsed < DB.config.interval then
    return
  end
  session.elapsed = 0

  local frameStartedAt = GetMs()
  for _ = 1, session.batch do
    if session.cursor > session.finish then
      if not DrainPendingItemsBeforeComplete() then
        SaveProgress()
        return
      end
      CompleteScan()
      return
    end

    local currentId = session.cursor
    if session.kind == "knownItems" then
      currentId = session.list and session.list[session.cursor]
      if not currentId then
        CompleteScan()
        return
      end
    end

    local found, state
    if IsItemScanKind(session.kind) then
      found, state = StoreItem(currentId, true)
      if state == "queued" then
        session.queued = session.queued + 1
      end
    else
      found = StoreSpell(currentId)
    end

    session.scanned = session.scanned + 1
    if found then
      session.found = session.found + 1
    end

    if session.kind == "knownItems" then
      session.cursor = session.cursor + 1
    else
      AdvanceScanCursor(currentId, found, state)
    end

    if GetMs() - frameStartedAt >= DB.config.maxFrameMs then
      break
    end
  end

  if IsItemScanKind(session.kind) then
    RetryPendingItems(math.max(1, math.floor(session.batch / 2)))
  end

  SaveProgress()

  local now = GetTime()
  if now - session.lastPrint >= 10 then
    session.lastPrint = now
    local label = session.kind == "knownItems" and "known item" or session.kind
    Print(label .. " scan at ID " .. session.cursor .. " / " .. session.finish .. ". Pending item cache: " .. #pendingOrder)
  end

  if now - session.lastUiUpdate >= 0.25 then
    session.lastUiUpdate = now
    UpdateProgressFrame()
    if UpdateMainFrame then
      UpdateMainFrame()
    end
  end
end

local function StartScan(kind, startId, endId, batch)
  if session.active then
    StopScan("Stopped previous scan.")
  end

  local progress = DB.progress[kind]
  local defaultStart = kind == "items" and DB.config.itemStart or DB.config.spellStart
  local defaultEnd = kind == "items" and DB.config.itemEnd or DB.config.spellEnd
  local defaultBatch = kind == "items" and DB.config.itemBatch or DB.config.spellBatch

  local start = ClampNumber(startId, progress.nextId or defaultStart, 1)
  local finish = ClampNumber(endId, progress.endId or defaultEnd, start)
  local batchSize = ClampNumber(batch, defaultBatch, 1)

  progress.startId = start
  progress.endId = finish
  progress.nextId = start
  progress.complete = false
  progress.startedAt = time()
  progress.updatedAt = time()

  session.active = true
  session.kind = kind
  session.cursor = start
  session.finish = finish
  session.batch = batchSize
  session.elapsed = 0
  session.scanned = 0
  session.found = 0
  session.queued = 0
  session.startedAt = GetTime()
  session.startedCursor = start
  session.lastPrint = 0
  session.lastUiUpdate = 0
  session.itemGapSkipStep = 1
  session.itemGapDenseUntil = 0
  session.pendingDrainStartedAt = nil
  session.list = nil
  session.listMode = nil

  frame:SetScript("OnUpdate", OnUpdate)
  UpdateProgressFrame(true)
  if UpdateMainFrame then
    UpdateMainFrame()
  end
  Print("Started " .. kind .. " scan: " .. start .. " -> " .. finish .. " (" .. batchSize .. " IDs per batch).")
  return true
end

local function StartKnownItemScan(batch, mode, offset, limit)
  EnsureDB()

  if session.active then
    StopScan("Stopped previous scan.")
  end

  local scanMode = string.lower(mode or "all")
  if scanMode ~= "missing" then
    scanMode = "all"
  end

  DB.config.storeTooltips = true
  local startOffset = ClampNumber(offset, DB.progress.knownItems.nextOffset or 1, 1)
  local scanLimit = math.max(0, tonumber(limit) or 0)
  local ids, sourceCount = BuildKnownItemList(scanMode, startOffset, scanLimit)
  if #ids == 0 then
    if sourceCount == 0 then
      Print("No known item IDs loaded. Regenerate KnownItems.lua and reload the addon.")
    else
      Print("No known item IDs need tooltip refresh in this window.")
    end
    return false
  end

  local batchSize = ClampNumber(batch, DB.config.knownItemBatch, 1)
  local progress = DB.progress.knownItems
  progress.startId = 1
  progress.endId = #ids
  progress.nextId = 1
  progress.complete = false
  progress.startedAt = time()
  progress.updatedAt = time()
  progress.mode = scanMode
  progress.offset = startOffset
  progress.limit = scanLimit
  progress.sourceCount = sourceCount
  progress.scanned = 0
  progress.found = 0
  progress.queued = 0

  session.active = true
  session.kind = "knownItems"
  session.cursor = 1
  session.finish = #ids
  session.batch = batchSize
  session.elapsed = 0
  session.scanned = 0
  session.found = 0
  session.queued = 0
  session.startedAt = GetTime()
  session.startedCursor = 1
  session.lastPrint = 0
  session.lastUiUpdate = 0
  session.itemGapSkipStep = 1
  session.itemGapDenseUntil = 0
  session.pendingDrainStartedAt = nil
  session.list = ids
  session.listMode = scanMode

  frame:SetScript("OnUpdate", OnUpdate)
  UpdateProgressFrame(true)
  if UpdateMainFrame then
    UpdateMainFrame()
  end

  progress.nextOffset = startOffset + sourceCount
  progress.windowCount = sourceCount
  progress.totalKnownIds = CountKnownItemIDs()

  Print("Started known item tooltip scan: " .. #ids .. " IDs from " .. sourceCount .. " known IDs (" .. scanMode .. ", offset " .. startOffset .. ", limit " .. (scanLimit > 0 and scanLimit or "all") .. ", " .. batchSize .. " IDs per batch).")
  return true
end

local function ScanSpellbook()
  EnsureDB()

  if session.active then
    StopScan("Stopped range scan before spellbook scrape.")
  end

  if not GetNumSpellTabs or not GetSpellTabInfo or not GetSpellBookItemInfo then
    Print("Spellbook API is not available on this client.")
    return
  end

  local bookType = BOOKTYPE_SPELL or "spell"
  local total = 0
  local stored = 0
  local tabs = GetNumSpellTabs() or 0

  DB.spellbook = {}

  for tabIndex = 1, tabs do
    local tabName, tabTexture, offset, numSpells = GetSpellTabInfo(tabIndex)
    offset = offset or 0
    numSpells = numSpells or 0

    for slot = 1, numSpells do
      local spellBookIndex = offset + slot
      local spellBookItemType, spellId = SafeCall(GetSpellBookItemInfo, spellBookIndex, bookType)
      local spellBookName, spellBookRank = SafeCall(GetSpellBookItemName, spellBookIndex, bookType)
      local link = SafeCall(GetSpellLink, spellBookIndex, bookType)

      if type(spellId) ~= "number" then
        spellId = ExtractSpellIdFromLink(link)
      end

      total = total + 1

      if spellId then
        local isPassive = SafeCall(IsPassiveSpell, spellBookIndex, bookType)
        local options = {
          source = "spellbook",
          spellBookIndex = spellBookIndex,
          spellBookTabName = tabName,
          spellBookTabIndex = tabIndex,
          spellBookTabTexture = tabTexture,
          spellBookItemType = spellBookItemType,
          spellBookName = spellBookName,
          spellBookRank = spellBookRank,
          isPassive = isPassive,
        }

        if StoreSpell(spellId, options) then
          stored = stored + 1
          DB.spellbook[spellId] = {
            id = spellId,
            name = spellBookName,
            rank = spellBookRank,
            link = link,
            tabName = tabName,
            tabIndex = tabIndex,
            tabTexture = tabTexture,
            spellBookIndex = spellBookIndex,
            spellBookItemType = spellBookItemType,
            passive = isPassive,
            capturedAt = time(),
          }
        end
      end
    end
  end

  DB.updatedAt = time()
  Print("Scanned spellbook: stored " .. stored .. " spells from " .. total .. " spellbook slots.")

  if UpdateMainFrame then
    UpdateMainFrame(true)
  end
end

local function ScanTrainer()
  EnsureDB()

  if session.active then
    StopScan("Stopped range scan before trainer scrape.")
  end

  if not GetNumTrainerServices or not GetTrainerServiceInfo then
    Print("Trainer API is not available on this client.")
    return
  end

  local total = GetNumTrainerServices() or 0
  if total <= 0 then
    Print("No trainer services found. Open a class trainer window first, then run /scrap trainer.")
    return
  end

  DB.trainerServices = DB.trainerServices or {}

  local updated = 0
  local created = 0
  local unmatched = 0

  for index = 1, total do
    local info = SafePack(GetTrainerServiceInfo, index)
    local name = info[1]
    local rank = info[2]
    local serviceType = info[3]
    local expanded = info[4]

    if name and name ~= "" then
      local link = FirstValue(SafePack(GetTrainerServiceItemLink, index))
      local tooltipText, tooltipLines = CaptureTrainerTooltip(index)
      local spellId = ExtractSpellIdFromLink(link) or ExtractSpellIdFromTooltip(tooltipLines)
      local levelReq = FirstValue(SafePack(GetTrainerServiceLevelReq, index))
      local cost = FirstValue(SafePack(GetTrainerServiceCost, index))
      local description = FirstValue(SafePack(GetTrainerServiceDescription, index))
      local icon = FirstValue(SafePack(GetTrainerServiceIcon, index))
      local skillLine = FirstValue(SafePack(GetTrainerServiceSkillLine, index))
      local skillReq = SafePack(GetTrainerServiceSkillReq, index)
      local stepReq = SafePack(GetTrainerServiceStepReq, index)
      local skillRequirement = PackToNamedTable(skillReq, { "name", "current", "required" })
      local stepRequirement = PackToNamedTable(stepReq, { "step", "required" })
      local numAbilityReq = FirstValue(SafePack(GetTrainerServiceNumAbilityReq, index)) or 0
      local abilityReqs = {}
      local spellRequiredIds = {}
      local spellRequiredNames = {}

      for reqIndex = 1, numAbilityReq do
        local raw = SafePack(GetTrainerServiceAbilityReq, index, reqIndex)
        local reqName, reqRank = ParseNameRank(raw[1], raw[2])
        local reqLink
        local reqSpellId

        for rawIndex = 1, raw.n or 0 do
          if type(raw[rawIndex]) == "string" then
            reqSpellId = reqSpellId or ExtractSpellIdFromLink(raw[rawIndex])
            if string.find(raw[rawIndex], "|H", 1, true) then
              reqLink = raw[rawIndex]
            end
          end
        end

        local resolvedIds = {}
        if reqSpellId then
          resolvedIds[#resolvedIds + 1] = reqSpellId
        else
          resolvedIds = ResolveSpellIdsByNameRank(reqName, reqRank)
        end

        if reqName then
          OrderedListInsert(spellRequiredNames, reqRank and (reqName .. " (" .. reqRank .. ")") or reqName)
        end

        for idIndex = 1, #resolvedIds do
          OrderedListInsert(spellRequiredIds, resolvedIds[idIndex])
        end

        abilityReqs[reqIndex] = {
          index = reqIndex,
          name = reqName,
          rank = reqRank,
          link = reqLink,
          spellId = reqSpellId,
          resolvedSpellIds = ArrayToOrderedList(resolvedIds),
          text = raw[1],
        }
      end

      local matchedIds = {}
      if spellId then
        matchedIds[#matchedIds + 1] = spellId
      else
        matchedIds = ResolveSpellIdsByNameRank(name, rank)
      end

      local trainerRecord = {
        index = index,
        id = spellId,
        learnedSpellId = spellId,
        learned_spell_id = spellId,
        name = name,
        rank = rank,
        rankIndex = ExtractRankNumber(rank),
        link = link,
        spellId = spellId,
        serviceType = serviceType,
        expanded = expanded,
        levelReq = levelReq,
        level_required = levelReq,
        cost = cost,
        description = description,
        icon = icon,
        skillLine = skillLine,
        skillReq = skillRequirement,
        stepReq = stepRequirement,
        numAbilityReq = numAbilityReq,
        abilityReqs = #abilityReqs > 0 and abilityReqs or nil,
        spellRequiredIds = #spellRequiredIds > 0 and spellRequiredIds or nil,
        spellRequiredNames = #spellRequiredNames > 0 and spellRequiredNames or nil,
        spell_required = BuildTrainerRequirementList(spellRequiredNames, skillRequirement, stepRequirement, skillLine),
        tooltip = tooltipText,
        tooltipLines = tooltipLines,
        tooltipCaptured = tooltipText ~= nil,
        tooltipForceShift = true,
        capturedAt = time(),
      }

      local fallbackServiceKey = NormalizeText(name) .. ":" .. NormalizeText(rank) .. ":" .. index
      DB.trainerServices[fallbackServiceKey] = nil
      if spellId then
        DB.trainerServices[spellId] = nil
      end

      DB.trainerServices[name] = DB.trainerServices[name] or {
        name = name,
        skillLine = skillLine,
        icon = icon,
        ranks = {},
      }

      local trainerAbility = DB.trainerServices[name]
      trainerAbility.name = name
      trainerAbility.skillLine = trainerAbility.skillLine or skillLine
      trainerAbility.icon = trainerAbility.icon or icon
      trainerAbility.ranks = trainerAbility.ranks or {}
      trainerAbility.ranks[trainerRecord.rankIndex] = trainerRecord

      if #matchedIds == 0 then
        unmatched = unmatched + 1
      end

      for matchedIndex = 1, #matchedIds do
        local matchedId = matchedIds[matchedIndex]
        local record = DB.spells[matchedId]
        if not record and StoreSpell(matchedId, { source = "trainer" }) then
          record = DB.spells[matchedId]
          created = created + 1
        end

        if record then
          record.trainer_learned = true
          record.trainerLearned = true
          record.trainer = trainerRecord
          record.trainerLevelReq = levelReq
          record.trainerCost = cost
          record.trainerServiceType = serviceType
          record.trainerSkillLine = skillLine
          record.trainerSkillReq = trainerRecord.skillReq
          record.trainerStepReq = trainerRecord.stepReq
          record.trainerAbilityReqs = abilityReqs

          if levelReq then
            record.level_required = levelReq
            record.requiredLevel = levelReq
          end

          if #spellRequiredIds > 0 then
            record.spell_required = spellRequiredIds
          end

          if #spellRequiredNames > 0 then
            record.spell_required_names = spellRequiredNames
          end

          record.capturedAt = time()
          updated = updated + 1
        end
      end
    end
  end

  DB.updatedAt = time()
  Print("Scanned trainer: " .. total .. " services, updated " .. updated .. " spell records, created " .. created .. ", unmatched " .. unmatched .. ".")

  if UpdateMainFrame then
    UpdateMainFrame(true)
  end
end

local function Status()
  if session.active then
    local label = session.kind == "knownItems" and "known item" or session.kind
    Print("Running " .. label .. " scan at ID " .. session.cursor .. " / " .. session.finish .. ". Pending item cache: " .. #pendingOrder)
  else
    Print("Idle.")
  end

  Print("Stored spells: " .. CountKeys(DB.spells) .. "; spellbook spells: " .. CountKeys(DB.spellbook) .. "; trainer services: " .. CountKeys(DB.trainerServices) .. "; stored items: " .. CountKeys(DB.items) .. "; known item IDs: " .. CountKnownItemIDs() .. ".")
end

local function ExportInfo()
  EnsureDB()
  DB.export.updatedAt = time()
  Print("Export format: AscensionScraperDB SavedVariables.")
  Print("Run /scrap save, then copy WTF/Account/<ACCOUNT>/SavedVariables/AscensionScraper.lua into output/addon with any unique .lua name.")
  Print("Repo import: pnpm game:import-scraper")
  Print("Current counts: spells " .. CountKeys(DB.spells) .. ", items " .. CountKeys(DB.items) .. ", spellbook " .. CountKeys(DB.spellbook) .. ", trainer " .. CountKeys(DB.trainerServices) .. ".")
end

local function Reset(kind)
  if kind == "all" then
    DB.items = {}
    DB.spells = {}
    DB.spellbook = {}
    DB.trainerServices = {}
    DB.progress.items.nextId = DB.config.itemStart
    DB.progress.knownItems.nextId = 1
    DB.progress.spells.nextId = DB.config.spellStart
    DB.progress.items.scanned = 0
    DB.progress.items.found = 0
    DB.progress.items.queued = 0
    DB.progress.knownItems.scanned = 0
    DB.progress.knownItems.found = 0
    DB.progress.knownItems.queued = 0
    DB.progress.spells.scanned = 0
    DB.progress.spells.found = 0
    DB.progress.items.complete = false
    DB.progress.knownItems.complete = false
    DB.progress.spells.complete = false
    Print("Reset all scraped data.")
  elseif kind == "items" then
    DB.items = {}
    DB.progress.items.nextId = DB.config.itemStart
    DB.progress.knownItems.nextId = 1
    DB.progress.items.scanned = 0
    DB.progress.items.found = 0
    DB.progress.items.queued = 0
    DB.progress.knownItems.scanned = 0
    DB.progress.knownItems.found = 0
    DB.progress.knownItems.queued = 0
    DB.progress.items.complete = false
    DB.progress.knownItems.complete = false
    Print("Reset item data.")
  elseif kind == "spells" then
    DB.spells = {}
    DB.spellbook = {}
    DB.trainerServices = {}
    DB.progress.spells.nextId = DB.config.spellStart
    DB.progress.spells.scanned = 0
    DB.progress.spells.found = 0
    DB.progress.spells.complete = false
    Print("Reset spell data.")
  else
    Print("Usage: /scrap reset items | spells | all")
  end
end

local function Help()
  Print("Commands:")
  Print("/scrap - open the AscensionScraper interface.")
  Print("/scrap items [start] [end] [batch] - scan item IDs. Default: resume, 1-999999.")
  Print("/scrap known [batch] [all|missing] [offset] [limit] - scan generated known item IDs; use limit for smaller chunks.")
  Print("/scrap spells [start] [end] [batch] - scan spell IDs. Default: resume, 1-999999.")
  Print("/scrap spellbook - scan your visible spellbook abilities with spellbook context.")
  Print("/scrap trainer - scan the currently open trainer and enrich matching spell records.")
  Print("/scrap export - show CoA Tavern SavedVariables export/import instructions.")
  Print("/scrap import - manually merge AscensionScraperImportDB from Import.lua.")
  Print("/scrap debug - show whether Import.lua data is loaded.")
  Print("/scrap item <id> or /scrap spell <id> - scan one ID.")
  Print("/scrap status - show current progress.")
  Print("/scrap stop - stop current scan.")
  Print("/scrap reset items|spells|all - clear saved data.")
  Print("/scrap progress on|off - show or hide the progress window.")
  Print("/scrap throttle <ms> - max scan work per frame. Default: 4.")
  Print("/scrap interval <seconds> - delay between batches. Default: 0.05.")
  Print("/scrap itemprobe on|off - skip IDs missing from GetItemInfoInstant before queueing. Default: off.")
  Print("/scrap gapskip on|off|max backtrack - adaptive item gap skipping. Default: off.")
  Print("/scrap tooltips on|off - capture item tooltip text. Turn off if a bad item crashes the client.")
  Print("/scrap reloadguard on|off - block unexpected ReloadUI calls. Default: on.")
  Print("/scrap save - reload UI so SavedVariables are written now.")
end

local function BoxNumber(box, fallback, minimum)
  if not box then
    return fallback
  end
  return ClampNumber(box:GetText(), fallback, minimum)
end

local function SetBoxNumber(box, value)
  if box then
    box:SetText(tostring(value or ""))
    box:SetCursorPosition(0)
  end
end

local function SetBoxText(box, value)
  if box then
    box:SetText(tostring(value or ""))
    box:SetCursorPosition(0)
  end
end

local UI_COLORS = {
  bg = { 0.025, 0.03, 0.035, 0.96 },
  panel = { 0.055, 0.06, 0.065, 0.78 },
  panelSoft = { 0.08, 0.07, 0.055, 0.42 },
  border = { 0.26, 0.28, 0.29, 0.95 },
  borderSoft = { 0.18, 0.20, 0.21, 0.75 },
  text = { 0.88, 0.86, 0.78 },
  muted = { 0.62, 0.66, 0.66 },
  gold = { 1.0, 0.78, 0.30 },
  teal = { 0.16, 0.68, 0.72 },
  tealHover = { 0.20, 0.82, 0.86 },
  red = { 0.76, 0.22, 0.18 },
  redHover = { 0.94, 0.30, 0.24 },
}

local function SetColor(object, color)
  if object and color then
    object:SetTextColor(color[1], color[2], color[3], color[4] or 1)
  end
end

local function ApplyBackdrop(target, bg, border)
  if not target or not target.SetBackdrop then
    return
  end

  target:SetBackdrop({
    bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
    tile = true,
    tileSize = 16,
    edgeSize = 12,
    insets = { left = 3, right = 3, top = 3, bottom = 3 },
  })
  target:SetBackdropColor(bg[1], bg[2], bg[3], bg[4] or 1)
  target:SetBackdropBorderColor(border[1], border[2], border[3], border[4] or 1)
end

local function CreatePanel(parent, title, x, y, width, height)
  local panel = CreateFrame("Frame", nil, parent)
  panel:SetWidth(width)
  panel:SetHeight(height)
  panel:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
  ApplyBackdrop(panel, UI_COLORS.panel, UI_COLORS.borderSoft)

  if title then
    local label = panel:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    label:SetPoint("TOPLEFT", panel, "TOPLEFT", 14, -10)
    label:SetText(title)
    SetColor(label, UI_COLORS.gold)
  end

  return panel
end

local function CreateLabel(parent, text, point, relativeTo, relativePoint, x, y, color)
  local label = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  label:SetPoint(point, relativeTo or parent, relativePoint or point, x or 0, y or 0)
  label:SetText(text)
  SetColor(label, color or UI_COLORS.muted)
  return label
end

local function CreateBox(parent, width, point, relativeTo, relativePoint, x, y, numeric)
  local box = CreateFrame("EditBox", nil, parent)
  box:SetWidth(width)
  box:SetHeight(24)
  box:SetPoint(point, relativeTo or parent, relativePoint or point, x or 0, y or 0)
  box:SetAutoFocus(false)
  if box.SetFontObject then
    box:SetFontObject(_G.GameFontHighlightSmall or "GameFontHighlightSmall")
  end
  if box.SetTextColor then
    box:SetTextColor(UI_COLORS.text[1], UI_COLORS.text[2], UI_COLORS.text[3], 1)
  end
  if box.SetTextInsets then
    box:SetTextInsets(7, 7, 0, 0)
  end
  ApplyBackdrop(box, { 0.015, 0.018, 0.020, 0.95 }, { 0.22, 0.30, 0.32, 0.95 })
  if numeric and box.SetNumeric then
    box:SetNumeric(true)
  end
  box:SetScript("OnEditFocusGained", function(self)
    if self.SetBackdropBorderColor then
      self:SetBackdropBorderColor(UI_COLORS.teal[1], UI_COLORS.teal[2], UI_COLORS.teal[3], 1)
    end
  end)
  box:SetScript("OnEditFocusLost", function(self)
    if self.SetBackdropBorderColor then
      self:SetBackdropBorderColor(0.22, 0.30, 0.32, 0.95)
    end
  end)
  box:SetScript("OnEscapePressed", function(self)
    self:ClearFocus()
  end)
  box:SetScript("OnEnterPressed", function(self)
    self:ClearFocus()
  end)
  return box
end

local function CreateButton(parent, text, width, point, relativeTo, relativePoint, x, y, onClick)
  local button = CreateFrame("Button", nil, parent)
  button:SetWidth(width)
  button:SetHeight(24)
  button:SetPoint(point, relativeTo or parent, relativePoint or point, x or 0, y or 0)
  if button.SetPushedTextOffset then
    button:SetPushedTextOffset(0, -1)
  end

  local normalBg = { 0.10, 0.12, 0.13, 0.95 }
  local hoverBg = { 0.14, 0.17, 0.18, 0.98 }
  local border = { 0.32, 0.36, 0.37, 0.95 }
  local fontColor = UI_COLORS.text

  if string.find(text, "Start", 1, true) or string.find(text, "Scrape", 1, true) or text == "Spellbook" or text == "Apply" then
    normalBg = { 0.05, 0.24, 0.26, 0.96 }
    hoverBg = { 0.07, 0.34, 0.36, 1 }
    border = UI_COLORS.teal
  elseif text == "Stop" then
    normalBg = { 0.28, 0.07, 0.06, 0.96 }
    hoverBg = { 0.42, 0.10, 0.08, 1 }
    border = UI_COLORS.red
  elseif text == "Save / Reload" then
    normalBg = { 0.25, 0.18, 0.07, 0.96 }
    hoverBg = { 0.35, 0.25, 0.10, 1 }
    border = UI_COLORS.gold
  end

  ApplyBackdrop(button, normalBg, border)

  local label = button:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  label:SetPoint("CENTER", button, "CENTER", 0, 0)
  label:SetText(text)
  SetColor(label, fontColor)
  button.label = label
  if button.SetText then
    button:SetText(text)
  end
  if button.SetFontString then
    button:SetFontString(label)
  end
  button:SetScript("OnEnter", function(self)
    if self.SetBackdropColor then
      self:SetBackdropColor(hoverBg[1], hoverBg[2], hoverBg[3], hoverBg[4] or 1)
    end
  end)
  button:SetScript("OnLeave", function(self)
    if self.SetBackdropColor then
      self:SetBackdropColor(normalBg[1], normalBg[2], normalBg[3], normalBg[4] or 1)
    end
  end)
  button:SetScript("OnMouseDown", function(self)
    if self.label then
      self.label:SetPoint("CENTER", self, "CENTER", 0, -1)
    end
  end)
  button:SetScript("OnMouseUp", function(self)
    if self.label then
      self.label:SetPoint("CENTER", self, "CENTER", 0, 0)
    end
  end)
  button:SetScript("OnClick", onClick)
  return button
end

local function CreateCheck(parent, name, text, point, relativeTo, relativePoint, x, y, onClick)
  local check = CreateFrame("CheckButton", name, parent)
  check:SetWidth(18)
  check:SetHeight(18)
  check:SetPoint(point, relativeTo or parent, relativePoint or point, x or 0, y or 0)
  ApplyBackdrop(check, { 0.012, 0.014, 0.016, 0.94 }, { 0.30, 0.34, 0.35, 0.95 })

  local checked = check:CreateTexture(nil, "ARTWORK")
  checked:SetPoint("CENTER", check, "CENTER", 0, 0)
  checked:SetWidth(14)
  checked:SetHeight(14)
  checked:SetTexture("Interface\\Buttons\\UI-CheckBox-Check")
  if check.SetCheckedTexture then
    check:SetCheckedTexture(checked)
  end

  local highlight = check:CreateTexture(nil, "HIGHLIGHT")
  highlight:SetAllPoints(check)
  highlight:SetTexture("Interface\\Buttons\\WHITE8X8")
  highlight:SetVertexColor(UI_COLORS.teal[1], UI_COLORS.teal[2], UI_COLORS.teal[3], 0.16)
  if check.SetHighlightTexture then
    check:SetHighlightTexture(highlight)
  end

  local label = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  label:SetPoint("LEFT", check, "RIGHT", 7, 0)
  label:SetText(text)
  SetColor(label, UI_COLORS.text)
  check.label = label
  check:SetScript("OnClick", onClick)
  return check
end

local function ApplyMainSettings()
  DB.config.itemBatch = BoxNumber(mainFields.itemBatch, DB.config.itemBatch, 1)
  DB.config.spellBatch = BoxNumber(mainFields.spellBatch, DB.config.spellBatch, 1)
  DB.config.maxFrameMs = BoxNumber(mainFields.throttle, DB.config.maxFrameMs, 1)

  local interval = tonumber(mainFields.interval and mainFields.interval:GetText() or "")
  if interval and interval >= 0 then
    DB.config.interval = interval
  end
  DB.config.itemGapMaxSkip = BoxNumber(mainFields.gapMax, DB.config.itemGapMaxSkip, 1)
  DB.config.itemGapBacktrack = BoxNumber(mainFields.gapBacktrack, DB.config.itemGapBacktrack, 0)

  if mainChecks.tooltips then
    DB.config.storeTooltips = mainChecks.tooltips:GetChecked() and true or false
  end
  if mainChecks.itemProbe then
    DB.config.itemInstantProbe = mainChecks.itemProbe:GetChecked() and true or false
  end
  if mainChecks.gapSkip then
    DB.config.itemGapSkip = mainChecks.gapSkip:GetChecked() and true or false
  end
  if mainChecks.reloadGuard then
    DB.config.reloadGuard = mainChecks.reloadGuard:GetChecked() and true or false
    InstallReloadGuard()
  end
  if mainChecks.progress then
    DB.config.showProgress = mainChecks.progress:GetChecked() and true or false
  end
  if mainChecks.pauseCombat then
    DB.config.pauseInCombat = mainChecks.pauseCombat:GetChecked() and true or false
  end

  DB.updatedAt = time()
end

local function SetMainFieldsFromDB()
  EnsureDB()
  SetBoxNumber(mainFields.itemStart, DB.progress.items.nextId or DB.config.itemStart)
  SetBoxNumber(mainFields.itemEnd, DB.progress.items.endId or DB.config.itemEnd)
  SetBoxNumber(mainFields.itemBatch, DB.config.itemBatch)
  SetBoxNumber(mainFields.spellStart, DB.progress.spells.nextId or DB.config.spellStart)
  SetBoxNumber(mainFields.spellEnd, DB.progress.spells.endId or DB.config.spellEnd)
  SetBoxNumber(mainFields.spellBatch, DB.config.spellBatch)
  SetBoxNumber(mainFields.throttle, DB.config.maxFrameMs)
  SetBoxText(mainFields.interval, DB.config.interval)
  SetBoxNumber(mainFields.gapMax, DB.config.itemGapMaxSkip)
  SetBoxNumber(mainFields.gapBacktrack, DB.config.itemGapBacktrack)

  if mainChecks.tooltips then
    mainChecks.tooltips:SetChecked(DB.config.storeTooltips)
  end
  if mainChecks.itemProbe then
    mainChecks.itemProbe:SetChecked(DB.config.itemInstantProbe)
  end
  if mainChecks.gapSkip then
    mainChecks.gapSkip:SetChecked(DB.config.itemGapSkip)
  end
  if mainChecks.reloadGuard then
    mainChecks.reloadGuard:SetChecked(DB.config.reloadGuard)
  end
  if mainChecks.progress then
    mainChecks.progress:SetChecked(DB.config.showProgress)
  end
  if mainChecks.pauseCombat then
    mainChecks.pauseCombat:SetChecked(DB.config.pauseInCombat)
  end
end

UpdateMainFrame = function(refreshFields)
  if not mainFrame then
    return
  end

  if refreshFields then
    SetMainFieldsFromDB()
  end

  local status
  if session.active then
    local elapsed = math.max(0.001, GetTime() - session.startedAt)
    local done = math.max(0, session.cursor - session.startedCursor)
    local rate = done / elapsed
    local remaining = math.max(0, session.finish - session.cursor + 1)
    local eta = rate > 0 and FormatDuration(remaining / rate) or "..."
    status = "Running " .. session.kind .. " | ID " .. session.cursor .. " / " .. session.finish .. " | " .. math.floor(rate) .. "/sec | ETA " .. eta .. " | pending " .. #pendingOrder
  else
    status = "Idle | Stored spells " .. CountKeys(DB.spells) .. " | Spellbook " .. CountKeys(DB.spellbook) .. " | Trainer " .. CountKeys(DB.trainerServices) .. " | Stored items " .. CountKeys(DB.items)
  end

  if mainStatusText then
    mainStatusText:SetText(status)
  end
end

local function CreateMainFrame()
  if mainFrame then
    return
  end

  mainFrame = CreateFrame("Frame", "AscensionScraperMainFrame", UIParent)
  mainFrame:SetWidth(660)
  mainFrame:SetHeight(526)
  mainFrame:SetPoint("CENTER", UIParent, "CENTER", 0, 0)
  mainFrame:SetMovable(true)
  mainFrame:EnableMouse(true)
  mainFrame:RegisterForDrag("LeftButton")
  mainFrame:SetScript("OnDragStart", function(self)
    self:StartMoving()
  end)
  mainFrame:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
  end)

  ApplyBackdrop(mainFrame, UI_COLORS.bg, UI_COLORS.border)

  local title = mainFrame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", mainFrame, "TOPLEFT", 26, -18)
  title:SetText("AscensionScraper")
  SetColor(title, UI_COLORS.gold)

  local close = CreateButton(mainFrame, "X", 24, "TOPRIGHT", mainFrame, "TOPRIGHT", -18, -16, function()
    mainFrame:Hide()
  end)
  close:SetHeight(22)

  local statusBand = CreateFrame("Frame", nil, mainFrame)
  statusBand:SetWidth(608)
  statusBand:SetHeight(28)
  statusBand:SetPoint("TOPLEFT", mainFrame, "TOPLEFT", 26, -42)
  ApplyBackdrop(statusBand, UI_COLORS.panelSoft, { 0.16, 0.18, 0.19, 0.75 })

  mainStatusText = mainFrame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  mainStatusText:SetPoint("LEFT", statusBand, "LEFT", 12, 0)
  mainStatusText:SetWidth(584)
  mainStatusText:SetJustifyH("LEFT")
  mainStatusText:SetText("Idle")

  local scanPanel = CreatePanel(mainFrame, "Scan ranges", 26, -82, 608, 118)
  CreateLabel(scanPanel, "Type", "TOPLEFT", scanPanel, "TOPLEFT", 18, -34, UI_COLORS.muted)
  CreateLabel(scanPanel, "Start ID", "TOPLEFT", scanPanel, "TOPLEFT", 118, -34, UI_COLORS.muted)
  CreateLabel(scanPanel, "End ID", "TOPLEFT", scanPanel, "TOPLEFT", 220, -34, UI_COLORS.muted)
  CreateLabel(scanPanel, "Batch", "TOPLEFT", scanPanel, "TOPLEFT", 322, -34, UI_COLORS.muted)

  CreateLabel(scanPanel, "Items", "TOPLEFT", scanPanel, "TOPLEFT", 18, -61, UI_COLORS.text)
  mainFields.itemStart = CreateBox(scanPanel, 84, "TOPLEFT", scanPanel, "TOPLEFT", 118, -56, true)
  mainFields.itemEnd = CreateBox(scanPanel, 84, "TOPLEFT", scanPanel, "TOPLEFT", 220, -56, true)
  mainFields.itemBatch = CreateBox(scanPanel, 62, "TOPLEFT", scanPanel, "TOPLEFT", 322, -56, true)
  CreateButton(scanPanel, "Start Items", 122, "TOPLEFT", scanPanel, "TOPLEFT", 462, -56, function()
    ApplyMainSettings()
    StartScan("items", mainFields.itemStart:GetText(), mainFields.itemEnd:GetText(), mainFields.itemBatch:GetText())
    UpdateMainFrame(true)
  end)

  CreateLabel(scanPanel, "Spells", "TOPLEFT", scanPanel, "TOPLEFT", 18, -91, UI_COLORS.text)
  mainFields.spellStart = CreateBox(scanPanel, 84, "TOPLEFT", scanPanel, "TOPLEFT", 118, -86, true)
  mainFields.spellEnd = CreateBox(scanPanel, 84, "TOPLEFT", scanPanel, "TOPLEFT", 220, -86, true)
  mainFields.spellBatch = CreateBox(scanPanel, 62, "TOPLEFT", scanPanel, "TOPLEFT", 322, -86, true)
  CreateButton(scanPanel, "Start Spells", 122, "TOPLEFT", scanPanel, "TOPLEFT", 462, -86, function()
    ApplyMainSettings()
    StartScan("spells", mainFields.spellStart:GetText(), mainFields.spellEnd:GetText(), mainFields.spellBatch:GetText())
    UpdateMainFrame(true)
  end)

  local singlePanel = CreatePanel(mainFrame, "Single capture", 26, -212, 608, 58)
  CreateLabel(singlePanel, "ID", "TOPLEFT", singlePanel, "TOPLEFT", 18, -34, UI_COLORS.text)
  mainFields.singleId = CreateBox(singlePanel, 112, "TOPLEFT", singlePanel, "TOPLEFT", 56, -28, true)
  CreateButton(singlePanel, "Scrape Item", 112, "TOPLEFT", singlePanel, "TOPLEFT", 190, -28, function()
    ApplyMainSettings()
    local id = tonumber(mainFields.singleId:GetText())
    if not id then
      Print("Enter a single ID first.")
      return
    end
    local found, state = StoreItem(id, true)
    Print(found and ("Stored item " .. id .. ".") or ("Item " .. id .. " not ready/found (" .. tostring(state) .. ")."))
    UpdateMainFrame()
  end)
  CreateButton(singlePanel, "Scrape Spell", 112, "TOPLEFT", singlePanel, "TOPLEFT", 314, -28, function()
    ApplyMainSettings()
    local id = tonumber(mainFields.singleId:GetText())
    if not id then
      Print("Enter a single ID first.")
      return
    end
    Print(StoreSpell(id) and ("Stored spell " .. id .. ".") or ("Spell " .. id .. " not found."))
    UpdateMainFrame()
  end)
  CreateButton(singlePanel, "Spellbook", 112, "TOPLEFT", singlePanel, "TOPLEFT", 438, -28, function()
    ApplyMainSettings()
    ScanSpellbook()
    UpdateMainFrame(true)
  end)

  local settingsPanel = CreatePanel(mainFrame, "Settings", 26, -282, 608, 132)
  CreateLabel(settingsPanel, "Throttle", "TOPLEFT", settingsPanel, "TOPLEFT", 18, -34, UI_COLORS.text)
  mainFields.throttle = CreateBox(settingsPanel, 58, "TOPLEFT", settingsPanel, "TOPLEFT", 82, -28, true)
  CreateLabel(settingsPanel, "ms/frame", "TOPLEFT", settingsPanel, "TOPLEFT", 148, -34, UI_COLORS.muted)
  CreateLabel(settingsPanel, "Interval", "TOPLEFT", settingsPanel, "TOPLEFT", 222, -34, UI_COLORS.text)
  mainFields.interval = CreateBox(settingsPanel, 58, "TOPLEFT", settingsPanel, "TOPLEFT", 286, -28, false)
  CreateLabel(settingsPanel, "seconds", "TOPLEFT", settingsPanel, "TOPLEFT", 352, -34, UI_COLORS.muted)
  CreateLabel(settingsPanel, "Gap max", "TOPLEFT", settingsPanel, "TOPLEFT", 18, -64, UI_COLORS.text)
  mainFields.gapMax = CreateBox(settingsPanel, 58, "TOPLEFT", settingsPanel, "TOPLEFT", 82, -58, true)
  CreateLabel(settingsPanel, "Backtrack", "TOPLEFT", settingsPanel, "TOPLEFT", 158, -64, UI_COLORS.text)
  mainFields.gapBacktrack = CreateBox(settingsPanel, 58, "TOPLEFT", settingsPanel, "TOPLEFT", 236, -58, true)
  CreateButton(settingsPanel, "Apply", 72, "TOPRIGHT", settingsPanel, "TOPRIGHT", -18, -28, function()
    ApplyMainSettings()
    UpdateProgressFrame(true)
    UpdateMainFrame()
    Print("Settings applied.")
  end)

  mainChecks.tooltips = CreateCheck(settingsPanel, "AscensionScraperTooltipsCheck", "Item tooltips", "TOPLEFT", settingsPanel, "TOPLEFT", 18, -88, function()
    ApplyMainSettings()
    UpdateMainFrame()
  end)
  mainChecks.itemProbe = CreateCheck(settingsPanel, "AscensionScraperItemProbeCheck", "Item probe", "TOPLEFT", settingsPanel, "TOPLEFT", 154, -88, function()
    ApplyMainSettings()
    UpdateMainFrame()
  end)
  mainChecks.gapSkip = CreateCheck(settingsPanel, "AscensionScraperGapSkipCheck", "Gap skip", "TOPLEFT", settingsPanel, "TOPLEFT", 286, -88, function()
    ApplyMainSettings()
    UpdateMainFrame()
  end)
  mainChecks.reloadGuard = CreateCheck(settingsPanel, "AscensionScraperReloadGuardCheck", "Reload guard", "TOPLEFT", settingsPanel, "TOPLEFT", 418, -88, function()
    ApplyMainSettings()
    UpdateMainFrame()
  end)
  mainChecks.progress = CreateCheck(settingsPanel, "AscensionScraperProgressCheck", "Show progress bar", "TOPLEFT", settingsPanel, "TOPLEFT", 18, -112, function()
    ApplyMainSettings()
    UpdateProgressFrame(true)
    UpdateMainFrame()
  end)
  mainChecks.pauseCombat = CreateCheck(settingsPanel, "AscensionScraperPauseCombatCheck", "Pause in combat", "TOPLEFT", settingsPanel, "TOPLEFT", 218, -112, function()
    ApplyMainSettings()
    UpdateMainFrame()
  end)

  CreateButton(mainFrame, "Stop", 82, "TOPLEFT", mainFrame, "TOPLEFT", 26, -432, function()
    StopScan("Stopped.")
    UpdateMainFrame(true)
  end)
  CreateButton(mainFrame, "Status", 82, "TOPLEFT", mainFrame, "TOPLEFT", 118, -432, function()
    Status()
    UpdateMainFrame()
  end)
  CreateButton(mainFrame, "Save / Reload", 122, "TOPLEFT", mainFrame, "TOPLEFT", 210, -432, function()
    ApplyMainSettings()
    Print("Reloading UI to write SavedVariables...")
    RequestReloadUI()
  end)
  CreateButton(mainFrame, "Help", 82, "TOPLEFT", mainFrame, "TOPLEFT", 342, -432, function()
    Help()
  end)
  CreateButton(mainFrame, "Close", 82, "TOPLEFT", mainFrame, "TOPLEFT", 434, -432, function()
    mainFrame:Hide()
  end)
  CreateButton(mainFrame, "Trainer", 82, "TOPLEFT", mainFrame, "TOPLEFT", 526, -432, function()
    ScanTrainer()
    UpdateMainFrame(true)
  end)

  CreateLabel(mainFrame, "Reset data", "TOPLEFT", mainFrame, "TOPLEFT", 26, -476, UI_COLORS.muted)
  CreateButton(mainFrame, "Items", 82, "TOPLEFT", mainFrame, "TOPLEFT", 118, -472, function()
    Reset("items")
    UpdateMainFrame(true)
  end)
  CreateButton(mainFrame, "Spells", 82, "TOPLEFT", mainFrame, "TOPLEFT", 210, -472, function()
    Reset("spells")
    UpdateMainFrame(true)
  end)
  CreateButton(mainFrame, "All", 82, "TOPLEFT", mainFrame, "TOPLEFT", 302, -472, function()
    Reset("all")
    UpdateMainFrame(true)
  end)

  local note = mainFrame:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  note:SetPoint("BOTTOMRIGHT", mainFrame, "BOTTOMRIGHT", -26, 20)
  note:SetWidth(270)
  note:SetJustifyH("RIGHT")
  note:SetText("SavedVariables write after /reload, logout, or Save / Reload.")
  SetColor(note, UI_COLORS.muted)

  mainFrame:Hide()
end

local function ShowMainFrame()
  EnsureDB()
  CreateMainFrame()
  SetMainFieldsFromDB()
  UpdateMainFrame()
  mainFrame:Show()
end

local function SplitWords(text)
  local words = {}
  for word in string.gmatch(text or "", "%S+") do
    words[#words + 1] = word
  end
  return words
end

local function HandleSlash(message)
  EnsureDB()

  local args = SplitWords(message)
  local command = string.lower(args[1] or "")

  if command == "" or command == "ui" or command == "open" then
    ShowMainFrame()
  elseif command == "items" then
    StartScan("items", args[2], args[3], args[4])
  elseif command == "known" or command == "knownitems" or command == "known-items" then
    StartKnownItemScan(args[2], args[3], args[4], args[5])
  elseif command == "spells" then
    StartScan("spells", args[2], args[3], args[4])
  elseif command == "spellbook" or command == "book" then
    ScanSpellbook()
  elseif command == "trainer" then
    ScanTrainer()
  elseif command == "export" then
    ExportInfo()
  elseif command == "import" then
    if not MergeImportDB() then
      Print("No import data merged. Run /scrap debug to check Import.lua.")
    end
  elseif command == "debug" then
    DebugImport()
  elseif command == "item" then
    local id = tonumber(args[2])
    if not id then
      Print("Usage: /scrap item <id>")
      return
    end
    local found, state = StoreItem(id, true)
    Print(found and ("Stored item " .. id .. ".") or ("Item " .. id .. " not ready/found (" .. tostring(state) .. ")."))
  elseif command == "spell" then
    local id = tonumber(args[2])
    if not id then
      Print("Usage: /scrap spell <id>")
      return
    end
    Print(StoreSpell(id) and ("Stored spell " .. id .. ".") or ("Spell " .. id .. " not found."))
  elseif command == "stop" or command == "pause" then
    StopScan("Stopped.")
  elseif command == "status" then
    Status()
  elseif command == "reset" then
    Reset(string.lower(args[2] or ""))
  elseif command == "tooltips" then
    local value = string.lower(args[2] or "")
    if value == "on" then
      DB.config.storeTooltips = true
      Print("Item tooltip capture enabled.")
    elseif value == "off" then
      DB.config.storeTooltips = false
      Print("Item tooltip capture disabled. This can avoid crashes from bad custom item hyperlinks.")
    else
      Print("Usage: /scrap tooltips on | off")
    end
  elseif command == "itemprobe" then
    local value = string.lower(args[2] or "")
    if value == "on" then
      DB.config.itemInstantProbe = true
      Print("Item instant probe enabled. Missing GetItemInfoInstant IDs will be skipped before tooltip fallback.")
    elseif value == "off" then
      DB.config.itemInstantProbe = false
      Print("Item instant probe disabled. Item scans will tooltip-probe IDs and queue cache misses.")
    else
      Print("Usage: /scrap itemprobe on | off")
    end
  elseif command == "gapskip" then
    local value = string.lower(args[2] or "")
    if value == "on" then
      DB.config.itemGapSkip = true
      Print("Adaptive item gap skipping enabled. Max skip " .. DB.config.itemGapMaxSkip .. ", backtrack " .. DB.config.itemGapBacktrack .. ".")
    elseif value == "off" then
      DB.config.itemGapSkip = false
      session.itemGapSkipStep = 1
      session.itemGapDenseUntil = 0
      Print("Adaptive item gap skipping disabled. Item scans will advance one ID at a time.")
    else
      local maxSkip = tonumber(args[2])
      local backtrack = tonumber(args[3])
      if not maxSkip then
        Print("Usage: /scrap gapskip on | off | <maxSkip> [backtrack], for example /scrap gapskip 50 60")
        return
      end

      maxSkip = math.floor(maxSkip)
      backtrack = math.floor(backtrack or DB.config.itemGapBacktrack or DEFAULTS.itemGapBacktrack)
      if maxSkip < 1 or backtrack < 0 then
        Print("Usage: /scrap gapskip <maxSkip> [backtrack], where maxSkip >= 1 and backtrack >= 0")
        return
      end

      DB.config.itemGapSkip = true
      DB.config.itemGapMaxSkip = maxSkip
      DB.config.itemGapBacktrack = backtrack
      session.itemGapSkipStep = 1
      session.itemGapDenseUntil = 0
      Print("Adaptive item gap skipping set to max skip " .. maxSkip .. " and backtrack " .. backtrack .. ".")
    end
  elseif command == "reloadguard" then
    local value = string.lower(args[2] or "")
    if value == "on" then
      DB.config.reloadGuard = true
      InstallReloadGuard()
      Print("Reload guard enabled. Unexpected ReloadUI calls will be blocked.")
    elseif value == "off" then
      DB.config.reloadGuard = false
      InstallReloadGuard()
      Print("Reload guard disabled.")
    else
      Print("Reload guard is " .. (DB.config.reloadGuard and "on" or "off") .. ". Usage: /scrap reloadguard on | off")
    end
  elseif command == "progress" then
    local value = string.lower(args[2] or "")
    if value == "on" then
      DB.config.showProgress = true
      UpdateProgressFrame(true)
      Print("Progress window enabled. Drag it with left click.")
    elseif value == "off" then
      DB.config.showProgress = false
      UpdateProgressFrame(true)
      Print("Progress window disabled.")
    else
      Print("Usage: /scrap progress on | off")
    end
  elseif command == "throttle" then
    local value = ClampNumber(args[2], DB.config.maxFrameMs, 1)
    DB.config.maxFrameMs = value
    Print("Max scan work per frame set to " .. value .. "ms.")
  elseif command == "interval" then
    local value = tonumber(args[2])
    if not value or value < 0 then
      Print("Usage: /scrap interval <seconds>, for example /scrap interval 0 or /scrap interval 0.05")
      return
    end
    DB.config.interval = value
    Print("Batch interval set to " .. value .. " seconds.")
  elseif command == "save" then
    Print("Reloading UI to write SavedVariables...")
    RequestReloadUI()
  else
    Help()
  end
end

AscensionScraperAPI = {
  EnsureDB = EnsureDB,
  GetDB = function()
    EnsureDB()
    return DB
  end,
  GetKnownItemIDCount = CountKnownItemIDs,
  GetKnownItemWindowInfo = function(mode, offset, limit)
    EnsureDB()
    return GetKnownItemWindowInfo(mode, offset, limit)
  end,
  GetKnownItemProgress = function()
    EnsureDB()
    return DB.progress.knownItems
  end,
  GetSessionState = function()
    return {
      active = session.active,
      kind = session.kind,
      cursor = session.cursor,
      finish = session.finish,
      batch = session.batch,
      pending = #pendingOrder,
      startedAt = session.startedAt,
      listMode = session.listMode,
    }
  end,
  Print = Print,
  SaveReload = RequestReloadUI,
  StartKnownItemScan = StartKnownItemScan,
  StopScan = StopScan,
  FlushKnownItemChunkToShard = FlushKnownItemChunkToShard,
  ShardDBName = ShardDBName,
}

local function OnEvent(_, event, ...)
  if event == "ADDON_LOADED" then
    local loadedAddon = ...
    if loadedAddon == ADDON_NAME then
      EnsureDB()
      MergeImportDB()
      Print("Loaded. Type /scrap for commands.")
    end
  elseif event == "GET_ITEM_INFO_RECEIVED" then
    local itemId, success = ...
    itemId = tonumber(itemId)
    if itemId and pendingItems[itemId] and (success == nil or success) then
      StoreItem(itemId, false)
    end
  end
end

frame:SetScript("OnEvent", OnEvent)
frame:RegisterEvent("ADDON_LOADED")
pcall(frame.RegisterEvent, frame, "GET_ITEM_INFO_RECEIVED")

SLASH_ASCENSIONSCRAPER1 = "/scrap"
SlashCmdList.ASCENSIONSCRAPER = HandleSlash
