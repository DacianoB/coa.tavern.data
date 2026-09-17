ScaleDumpDB = ScaleDumpDB or {}

local SCHEMA = {
  "RequiredLevel",
  "SellPrice",
  "ItemArmor",
  "ItemArmorReborn",
  "ItemBlock",
  "ItemDamageMin0",
  "ItemDamageMax0",
  "ItemDamageMin1",
  "ItemDamageMax1",
  "ItemHolyRes",
  "ItemFireRes",
  "ItemNatureRes",
  "ItemFrostRes",
  "ItemShadowRes",
  "ItemArcaneRes",
  "RandomProperty",
  "ItemStatsType0",
  "ItemStatsValue0",
  "ItemStatsType1",
  "ItemStatsValue1",
  "ItemStatsType2",
  "ItemStatsValue2",
  "ItemStatsType3",
  "ItemStatsValue3",
  "ItemStatsType4",
  "ItemStatsValue4",
  "ItemStatsType5",
  "ItemStatsValue5",
  "ItemStatsType6",
  "ItemStatsValue6",
  "ItemStatsType7",
  "ItemStatsValue7",
  "ItemStatsType8",
  "ItemStatsValue8",
  "ItemStatsType9",
  "ItemStatsValue9",
}

local STAT_MASK = {
  [0]="Mana",[1]="Health",[3]="Agility",[4]="Strength",[5]="Intellect",[6]="Spirit",[7]="Stamina",
  [12]="Defense Rating",[13]="Dodge Rating",[14]="Parry Rating",[15]="Block Rating",
  [31]="Hit Rating",[32]="Crit Rating",[35]="Resilience Rating",[36]="Haste Rating",
  [37]="Expertise Rating",[38]="Attack Power",[39]="Ranged Attack Power",
  [44]="Armor Penetration Rating",[45]="Spell Power",[48]="Block Value",
}

ScaleDumpDB.schema = SCHEMA
ScaleDumpDB.statMask = STAT_MASK
ScaleDumpDB.items = ScaleDumpDB.items or {}
ScaleDumpDB.progress = ScaleDumpDB.progress or {}
ScaleDumpDB.badItems = ScaleDumpDB.badItems or {}
ScaleDumpDB.lastCall = ScaleDumpDB.lastCall or nil

local DEFAULT_START_INDEX = 1
local DEFAULT_SCAN_MODE = "anchors15"
local DEFAULT_CALLS_PER_FRAME = 50
local DEFAULT_MIN_ITEM_ID = 1
local DEFAULT_MAX_SAVED_PER_RUN = 6000

local CANARY_ITEM_ID = 8124
local CANARY_LEVEL = 30
local CANARY_EVERY_CALLS = 5000
local CANARY_COOLDOWN_SECONDS = 2
local CANARY_STOP_FAILURES = 1

local HEARTBEAT_PREFIX = "SCDUMP"
local HEARTBEAT_EVERY_CALLS = 1000
local HEARTBEAT_TIMEOUT_SECONDS = 5
local HEARTBEAT_COOLDOWN_SECONDS = 0.25
local HEARTBEAT_STOP_FAILURES = 1

local frame = CreateFrame("Frame")
local running = false

local chunks = AscensionScraperKnownItemIDChunks or {}
local knownCount = AscensionScraperKnownItemIDCount or 0

-- Progress is by known-ID index, but IDs are streamed from chunks.
local index = 1
local maxIndex = knownCount

-- Streaming chunk cursor.
local chunkIndex = 1
local chunkPos = 1
local chunkIDs = nil

local scanMode = DEFAULT_SCAN_MODE
local scanLevels = {1, 15, 30, 45, 60}
local levelIndex = 1

local activeItemID = nil
local activeItemOut = nil
local activeScanLevels = nil

local callsPerFrame = DEFAULT_CALLS_PER_FRAME
local minItemID = DEFAULT_MIN_ITEM_ID
local maxSavedPerRun = DEFAULT_MAX_SAVED_PER_RUN

local scanned = 0
local saved = 0
local skipped = 0
local errors = 0
local lastPrint = 0
local lastScalingIndex = nil
local lastScalingItemID = nil
local savedAtRunStart = 0
local apiCalls = 0
local nextCanaryAt = CANARY_EVERY_CALLS
local canaryFailures = 0
local nextHeartbeatAt = HEARTBEAT_EVERY_CALLS
local heartbeatSeq = 0
local heartbeatPending = nil
local heartbeatDeadline = 0
local heartbeatFailures = 0
local pauseUntil = 0

local function ResetHealthWatch()
  apiCalls = 0
  nextCanaryAt = CANARY_EVERY_CALLS
  canaryFailures = 0
  nextHeartbeatAt = HEARTBEAT_EVERY_CALLS
  heartbeatSeq = 0
  heartbeatPending = nil
  heartbeatDeadline = 0
  heartbeatFailures = 0
  pauseUntil = 0
end

local function RegisterHeartbeatPrefix()
  if RegisterAddonMessagePrefix then
    pcall(RegisterAddonMessagePrefix, HEARTBEAT_PREFIX)
  end
end

local function HeartbeatTarget()
  if UnitName then
    local name = UnitName("player")

    if name and name ~= "" then
      return name
    end
  end

  return nil
end

RegisterHeartbeatPrefix()

local function ParseChunk(chunk)
  local ids = {}

  if type(chunk) == "string" then
    for id in string.gmatch(chunk, "%d+") do
      ids[#ids + 1] = tonumber(id)
    end
  elseif type(chunk) == "table" then
    for i = 1, #chunk do
      local id = tonumber(chunk[i])
      if id then
        ids[#ids + 1] = id
      end
    end
  end

  return ids
end

local function LoadCurrentChunk()
  while true do
    if chunkIDs and chunkPos <= #chunkIDs then
      return true
    end

    if chunkIndex > #chunks then
      return false
    end

    chunkIDs = ParseChunk(chunks[chunkIndex])
    chunkPos = 1
    chunkIndex = chunkIndex + 1

    if chunkIDs and #chunkIDs > 0 then
      return true
    end
  end
end

local function NextKnownID()
  if not LoadCurrentChunk() then
    return nil
  end

  local itemID = chunkIDs[chunkPos]
  chunkPos = chunkPos + 1

  return itemID
end

local function SeekToIndex(targetIndex)
  -- Reset streaming cursor and walk forward without storing all IDs.
  chunkIndex = 1
  chunkPos = 1
  chunkIDs = nil
  index = 1

  while index < targetIndex do
    local ignored = NextKnownID()

    if not ignored then
      return false
    end

    index = index + 1
  end

  return true
end

local function BuildFullLevels()
  local t = {}

  for i = 1, 60 do
    t[#t + 1] = i
  end

  return t
end

local function SetMode(mode)
  if mode == "one" then
    scanMode = "one"
    scanLevels = {1}
  elseif mode == "full" then
    scanMode = "full"
    scanLevels = BuildFullLevels()
  else
    scanMode = "anchors15"
    scanLevels = {1, 15, 30, 45, 60}
  end
end

local function LevelsText()
  return table.concat(scanLevels, ",")
end

local function CopyLevels(levels)
  local out = {}

  for i = 1, #levels do
    out[i] = levels[i]
  end

  return out
end

local function AddUniqueLevel(levels, level)
  level = tonumber(level)

  if not level or level < 1 then
    return
  end

  level = math.floor(level)

  for i = 1, #levels do
    if levels[i] == level then
      return
    end
  end

  levels[#levels + 1] = level
  table.sort(levels)
end

local function GetDefaultItemLevel(itemID)
  if not GetItemLevelInstant then
    return nil
  end

  local ok, level = pcall(GetItemLevelInstant, itemID)

  if ok then
    return tonumber(level)
  end

  return nil
end

local function BuildItemLevels(itemID)
  local levels = CopyLevels(scanLevels)

  if scanMode ~= "one" then
    AddUniqueLevel(levels, GetDefaultItemLevel(itemID))
  end

  return levels
end

local function ActiveLevelsText()
  return table.concat(activeScanLevels or scanLevels, ",")
end

local function PackSparse(stats)
  local parts = {}

  for i = 1, #SCHEMA do
    local v = stats[SCHEMA[i]]

    if type(v) == "number" and v ~= 0 then
      parts[#parts + 1] = i .. "=" .. v
    end
  end

  if #parts == 0 then
    return nil
  end

  return table.concat(parts, ";")
end

local function SaveProgress()
  ScaleDumpDB.progress.index = index
  ScaleDumpDB.progress.maxIndex = maxIndex

  ScaleDumpDB.progress.chunkIndex = chunkIndex
  ScaleDumpDB.progress.chunkPos = chunkPos

  ScaleDumpDB.progress.scanMode = scanMode
  ScaleDumpDB.progress.callsPerFrame = callsPerFrame
  ScaleDumpDB.progress.minItemID = minItemID
  ScaleDumpDB.progress.maxSavedPerRun = maxSavedPerRun

  ScaleDumpDB.progress.activeItemID = activeItemID
  ScaleDumpDB.progress.activeItemOut = activeItemOut
  ScaleDumpDB.progress.activeScanLevels = activeScanLevels
  ScaleDumpDB.progress.levelIndex = levelIndex

  ScaleDumpDB.progress.scanned = scanned
  ScaleDumpDB.progress.saved = saved
  ScaleDumpDB.progress.skipped = skipped
  ScaleDumpDB.progress.errors = errors
  ScaleDumpDB.progress.lastScalingIndex = lastScalingIndex
  ScaleDumpDB.progress.lastScalingItemID = lastScalingItemID
  ScaleDumpDB.progress.last_scalling_index = lastScalingIndex
  ScaleDumpDB.progress.last_scalling_item_id = lastScalingItemID
  ScaleDumpDB.progress.savedAtRunStart = savedAtRunStart
  ScaleDumpDB.progress.apiCalls = apiCalls
  ScaleDumpDB.progress.canaryFailures = canaryFailures
  ScaleDumpDB.progress.heartbeatFailures = heartbeatFailures
end

local function StartNextItem()
  activeItemID = nil
  activeItemOut = nil
  activeScanLevels = nil
  levelIndex = 1

  while index <= maxIndex do
    local itemID = NextKnownID()
    index = index + 1

    if itemID and itemID >= minItemID and not ScaleDumpDB.badItems[itemID] then
      activeItemID = itemID
      activeScanLevels = BuildItemLevels(itemID)
      return true
    else
      skipped = skipped + 1
      scanned = scanned + 1
    end
  end

  return false
end

local function FinishItem()
  if activeItemID and activeItemOut then
    lastScalingIndex = index - 1
    lastScalingItemID = activeItemID
    ScaleDumpDB.items[activeItemID] = activeItemOut
    saved = saved + 1
  else
    skipped = skipped + 1
  end

  scanned = scanned + 1

  activeItemID = nil
  activeItemOut = nil
  activeScanLevels = nil
  levelIndex = 1

  if maxSavedPerRun > 0 and (saved - savedAtRunStart) >= maxSavedPerRun then
    running = false
    SaveProgress()
    print("ScaleDump run cap reached:", maxSavedPerRun, "new saved items. Use /scaleresume to continue from this point.")
  end
end

local function RunCanary()
  local ok, stats = pcall(GetScalingItemStats, CANARY_ITEM_ID, CANARY_LEVEL)

  if ok and type(stats) == "table" then
    canaryFailures = 0
    nextCanaryAt = apiCalls + CANARY_EVERY_CALLS
    pauseUntil = GetTime() + CANARY_COOLDOWN_SECONDS
    return true
  end

  canaryFailures = canaryFailures + 1
  nextCanaryAt = apiCalls + CANARY_EVERY_CALLS
  pauseUntil = GetTime() + CANARY_COOLDOWN_SECONDS
  SaveProgress()

  print(
    "ScaleDump canary failed.",
    "itemID", CANARY_ITEM_ID,
    "level", CANARY_LEVEL,
    "failures", canaryFailures .. "/" .. CANARY_STOP_FAILURES
  )

  if canaryFailures >= CANARY_STOP_FAILURES then
    running = false
    SaveProgress()
    print("ScaleDump stopped because a known scalable item stopped returning data. Log out/reconnect, then use /scaleresume.")
  end

  return false
end

local function StopForHeartbeat(reason)
  heartbeatFailures = heartbeatFailures + 1
  heartbeatPending = nil
  heartbeatDeadline = 0
  nextHeartbeatAt = apiCalls + HEARTBEAT_EVERY_CALLS
  SaveProgress()

  print(
    "ScaleDump heartbeat failed.",
    reason,
    "failures", heartbeatFailures .. "/" .. HEARTBEAT_STOP_FAILURES
  )

  if heartbeatFailures >= HEARTBEAT_STOP_FAILURES then
    if not running then
      print("ScaleDump heartbeat did not return.")
      return
    end

    running = false
    SaveProgress()
    print("ScaleDump stopped because the server heartbeat did not return. Fully reconnect, then use /scaleresume.")
  end
end

local function SendHeartbeat()
  if not SendAddonMessage then
    nextHeartbeatAt = apiCalls + HEARTBEAT_EVERY_CALLS
    return true
  end

  local target = HeartbeatTarget()

  if not target then
    nextHeartbeatAt = apiCalls + HEARTBEAT_EVERY_CALLS
    return true
  end

  heartbeatSeq = heartbeatSeq + 1
  heartbeatPending = "PING:" .. heartbeatSeq
  heartbeatDeadline = GetTime() + HEARTBEAT_TIMEOUT_SECONDS

  local ok = pcall(SendAddonMessage, HEARTBEAT_PREFIX, heartbeatPending, "WHISPER", target)

  if not ok then
    StopForHeartbeat("send-error")
    return false
  end

  return true
end

local function ScanOneCall()
  if not activeItemID then
    if not StartNextItem() then
      running = false
      SaveProgress()
      print("ScaleDump finished.", "saved", saved, "skipped", skipped)
      return
    end
  end

  activeScanLevels = activeScanLevels or BuildItemLevels(activeItemID)

  local level = activeScanLevels[levelIndex]

  if not level then
    FinishItem()
    return
  end

  ScaleDumpDB.lastCall = {
    itemID = activeItemID,
    level = level,
    index = index,
    mode = scanMode,
  }

  local ok, stats = pcall(GetScalingItemStats, activeItemID, level)
  apiCalls = apiCalls + 1

  if ok and type(stats) == "table" then
    local packed = PackSparse(stats)

    if packed then
      activeItemOut = activeItemOut or {}
      activeItemOut["L" .. level] = packed
    end
  elseif not ok then
    errors = errors + 1
  end

  levelIndex = levelIndex + 1
end

frame:SetScript("OnUpdate", function()
  if heartbeatPending then
    if GetTime() >= heartbeatDeadline then
      StopForHeartbeat("timeout")
    end

    return
  end

  if not running then return end

  if pauseUntil > 0 and GetTime() < pauseUntil then
    return
  end

  pauseUntil = 0

  if apiCalls >= nextHeartbeatAt then
    SendHeartbeat()
    return
  end

  if apiCalls >= nextCanaryAt then
    RunCanary()
    if not running then return end
    if pauseUntil > 0 and GetTime() < pauseUntil then return end
  end

  for i = 1, callsPerFrame do
    ScanOneCall()
    if not running then return end
    if pauseUntil > 0 and GetTime() < pauseUntil then return end
  end

  if scanned - lastPrint >= 1000 then
    lastPrint = scanned
    SaveProgress()

    print(
      "ScaleDump",
      "index", index .. "/" .. maxIndex,
      "active", activeItemID or "nil",
      "saved", saved,
      "skipped", skipped,
      "errors", errors
    )
  end
end)

frame:SetScript("OnEvent", function(_, event, prefix, msg)
  if event ~= "CHAT_MSG_ADDON" then return end
  if prefix ~= HEARTBEAT_PREFIX then return end
  if not heartbeatPending or msg ~= heartbeatPending then return end

  heartbeatPending = nil
  heartbeatDeadline = 0
  heartbeatFailures = 0
  nextHeartbeatAt = apiCalls + HEARTBEAT_EVERY_CALLS
  pauseUntil = GetTime() + HEARTBEAT_COOLDOWN_SECONDS

  if not running then
    print("ScaleDump heartbeat OK.")
  end
end)

frame:RegisterEvent("CHAT_MSG_ADDON")

SLASH_SCALEDUMP1 = "/scaledump"
SlashCmdList.SCALEDUMP = function(msg)
  -- /scaledump startIndex mode callsPerFrame minItemID maxSavedPerRun
  -- /scaledump 1 anchors15 50 1 6000

  local a, b, c, d, e = msg:match("^(%S*)%s*(%S*)%s*(%S*)%s*(%S*)%s*(%S*)$")

  if not chunks or #chunks == 0 then
    print("ScaleDump ERROR: AscensionScraperKnownItemIDChunks not loaded.")
    print("Make sure the known IDs file loads before ScaleDump.lua in the TOC.")
    return
  end

  local startIndex = tonumber(a) or DEFAULT_START_INDEX

  maxIndex = AscensionScraperKnownItemIDCount or knownCount or 0

  if not SeekToIndex(startIndex) then
    print("ScaleDump ERROR: Could not seek to index", startIndex)
    return
  end

  SetMode(b ~= "" and b or DEFAULT_SCAN_MODE)
  callsPerFrame = tonumber(c) or DEFAULT_CALLS_PER_FRAME
  minItemID = tonumber(d) or DEFAULT_MIN_ITEM_ID
  maxSavedPerRun = tonumber(e) or DEFAULT_MAX_SAVED_PER_RUN

  activeItemID = nil
  activeItemOut = nil
  activeScanLevels = nil
  levelIndex = 1
  ResetHealthWatch()

  scanned = 0
  saved = 0
  skipped = 0
  errors = 0
  lastPrint = 0
  lastScalingIndex = nil
  lastScalingItemID = nil
  savedAtRunStart = saved

  running = true
  SaveProgress()

  print("ScaleDump started.")
  print("Index:", index .. "/" .. maxIndex)
  print("Mode:", scanMode, "levels:", LevelsText())
  print("Calls/frame:", callsPerFrame, "minItemID:", minItemID)
  print("Run cap:", maxSavedPerRun > 0 and (maxSavedPerRun .. " new saved items") or "unlimited")
  print("Heartbeat:", "self-whisper every", HEARTBEAT_EVERY_CALLS, "calls", "timeout", HEARTBEAT_TIMEOUT_SECONDS .. "s")
  print("Canary:", CANARY_ITEM_ID, "L" .. CANARY_LEVEL, "every", CANARY_EVERY_CALLS, "calls")
end

SLASH_SCALESTOP1 = "/scalestop"
SlashCmdList.SCALESTOP = function()
  running = false
  SaveProgress()
  print("ScaleDump stopped.", "index", index, "saved", saved, "skipped", skipped)
end

SLASH_SCALERESUME1 = "/scaleresume"
SlashCmdList.SCALERESUME = function(msg)
  local p = ScaleDumpDB.progress or {}
  local overrideMaxSaved = tonumber(msg)

  index = p.index or index or 1
  maxIndex = p.maxIndex or maxIndex or knownCount

  chunkIndex = p.chunkIndex or 1
  chunkPos = p.chunkPos or 1
  chunkIDs = nil

  if chunkIndex > 1 then
    chunkIDs = ParseChunk(chunks[chunkIndex - 1])
  end

  SetMode(p.scanMode or scanMode or DEFAULT_SCAN_MODE)
  callsPerFrame = p.callsPerFrame or callsPerFrame or DEFAULT_CALLS_PER_FRAME
  minItemID = p.minItemID or minItemID or DEFAULT_MIN_ITEM_ID
  maxSavedPerRun = overrideMaxSaved or p.maxSavedPerRun or maxSavedPerRun or DEFAULT_MAX_SAVED_PER_RUN

  activeItemID = p.activeItemID
  activeItemOut = p.activeItemOut
  activeScanLevels = p.activeScanLevels or (activeItemID and BuildItemLevels(activeItemID)) or nil
  levelIndex = p.levelIndex or 1
  ResetHealthWatch()

  scanned = p.scanned or 0
  saved = p.saved or 0
  skipped = p.skipped or 0
  errors = p.errors or 0
  lastScalingIndex = p.lastScalingIndex or p.last_scalling_index or lastScalingIndex
  lastScalingItemID = p.lastScalingItemID or p.last_scalling_item_id or lastScalingItemID
  lastPrint = scanned
  savedAtRunStart = saved

  running = true

  print("ScaleDump resumed.", "index", index .. "/" .. maxIndex, "active", activeItemID or "nil", "runCap", maxSavedPerRun)
end

SLASH_SCALESTATUS1 = "/scalestatus"
SlashCmdList.SCALESTATUS = function()
  print(
    "ScaleDump",
    running and "running" or "stopped",
    "index", index .. "/" .. maxIndex,
    "active", activeItemID or "nil",
    "levelStep", levelIndex,
    "levels", ActiveLevelsText(),
    "saved", saved,
    "lastScaling", (lastScalingIndex or "nil") .. "/" .. (lastScalingItemID or "nil"),
    "runSaved", saved - savedAtRunStart,
    "runCap", maxSavedPerRun,
    "skipped", skipped,
    "errors", errors,
    "apiCalls", apiCalls,
    "heartbeat", heartbeatPending and "waiting" or "ready",
    "heartbeatFails", heartbeatFailures,
    "canaryFails", canaryFailures,
    "mode", scanMode,
    "chunk", chunkIndex,
    "chunkPos", chunkPos
  )
end

SLASH_SCALEPING1 = "/scaleping"
SlashCmdList.SCALEPING = function()
  if heartbeatPending then
    print("ScaleDump heartbeat already waiting.")
    return
  end

  if SendHeartbeat() then
    print("ScaleDump heartbeat sent.")
  end
end

SLASH_SCALEWIPE1 = "/scalewipe"
SlashCmdList.SCALEWIPE = function()
  running = false

  for k in pairs(ScaleDumpDB) do
    ScaleDumpDB[k] = nil
  end

  ScaleDumpDB.schema = SCHEMA
  ScaleDumpDB.statMask = STAT_MASK
  ScaleDumpDB.items = {}
  ScaleDumpDB.progress = {}
  ScaleDumpDB.badItems = {}

  index = 1
  chunkIndex = 1
  chunkPos = 1
  chunkIDs = nil

  activeItemID = nil
  activeItemOut = nil
  activeScanLevels = nil
  levelIndex = 1
  maxSavedPerRun = DEFAULT_MAX_SAVED_PER_RUN

  scanned = 0
  saved = 0
  skipped = 0
  errors = 0
  lastPrint = 0
  lastScalingIndex = nil
  lastScalingItemID = nil
  savedAtRunStart = 0
  ResetHealthWatch()

  print("ScaleDumpDB wiped. Use /reload.")
end

SLASH_SCALELAST1 = "/scalelast"
SlashCmdList.SCALELAST = function()
  local c = ScaleDumpDB.lastCall

  if not c then
    print("No lastCall.")
    return
  end

  print("Last call:", "itemID", c.itemID, "level", c.level, "index", c.index, "mode", c.mode)
end

SLASH_SCALEBAD1 = "/scalebad"
SlashCmdList.SCALEBAD = function(msg)
  local itemID = tonumber(msg)

  if not itemID and ScaleDumpDB.lastCall then
    itemID = ScaleDumpDB.lastCall.itemID
  end

  if itemID then
    ScaleDumpDB.badItems[itemID] = true

    if activeItemID == itemID then
      activeItemID = nil
      activeItemOut = nil
      activeScanLevels = nil
      levelIndex = 1
      ResetHealthWatch()
      SaveProgress()
    end

    print("Bad item added:", itemID)
  else
    print("No itemID and no lastCall.")
  end
end

SLASH_SCALETEST1 = "/scaletest"
SlashCmdList.SCALETEST = function(msg)
  local itemID = tonumber(msg) or 7673
  local levels = BuildItemLevels(itemID)

  print("Testing", itemID, "mode", scanMode, "levels", table.concat(levels, ","))

  for i = 1, #levels do
    local level = levels[i]

    ScaleDumpDB.lastCall = {
      itemID = itemID,
      level = level,
      index = index,
      mode = "test",
    }

    local ok, stats = pcall(GetScalingItemStats, itemID, level)

    if ok and type(stats) == "table" then
      print("L" .. level, PackSparse(stats) or "EMPTY")
    else
      print("L" .. level, "FAILED")
    end
  end
end
