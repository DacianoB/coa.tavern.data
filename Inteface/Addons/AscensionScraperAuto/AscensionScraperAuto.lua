local ADDON_NAME = "AscensionScraperAuto"

local DB
local frame = CreateFrame("Frame")
local tickElapsed = 0
local readyAt = nil
local missingApiWarned = false

local DEFAULTS = {
  batch = 25,
  mode = "missing",
  chunkSize = 20000,
  offset = 1,
  tickSeconds = 1,
  useShards = true,
  maxShards = 30,
  clearMainAfterShard = true,
}

local function Print(message)
  DEFAULT_CHAT_FRAME:AddMessage("|cff99ee66AscensionScraperAuto:|r " .. tostring(message))
end

local function CopyDefaults(target, defaults)
  for key, value in pairs(defaults) do
    if target[key] == nil then
      target[key] = value
    end
  end
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

local function NormalizeMode(value)
  value = string.lower(tostring(value or ""))
  if value == "all" then
    return "all"
  end
  return "missing"
end

local function SplitWords(text)
  local words = {}
  for word in string.gmatch(text or "", "%S+") do
    words[#words + 1] = word
  end
  return words
end

local function EnsureDB()
  AscensionScraperAutoDB = AscensionScraperAutoDB or {}
  DB = AscensionScraperAutoDB
  DB.config = DB.config or {}
  DB.state = DB.state or {}
  CopyDefaults(DB.config, DEFAULTS)
  CopyDefaults(DB.state, {
    enabled = false,
    phase = "idle",
    offset = DB.config.offset,
    nextShard = 1,
    chunksDone = 0,
    windowsSkipped = 0,
    done = false,
  })
end

local function GetAPI()
  return AscensionScraperAPI
end

local function KnownTotal(api)
  if api and api.GetKnownItemIDCount then
    return tonumber(api.GetKnownItemIDCount()) or 0
  end
  return 0
end

local function Status()
  EnsureDB()
  local state = DB.state
  local api = GetAPI()
  local total = KnownTotal(api)
  local session = api and api.GetSessionState and api.GetSessionState() or nil
  local active = session and session.active and ("yes (" .. tostring(session.kind) .. " " .. tostring(session.cursor) .. "/" .. tostring(session.finish) .. ")") or "no"

  Print("Enabled: " .. tostring(state.enabled) .. "; phase: " .. tostring(state.phase) .. "; mode: " .. tostring(DB.config.mode) .. "; offset: " .. tostring(state.offset) .. " / " .. tostring(total) .. "; chunk: " .. tostring(DB.config.chunkSize) .. "; batch: " .. tostring(DB.config.batch) .. "; shard: " .. tostring(state.nextShard) .. "/" .. tostring(DB.config.maxShards) .. "; scraper active: " .. active .. ".")
end

local function MarkDone(message, reload)
  local state = DB.state
  state.enabled = false
  state.done = true
  state.phase = "done"
  state.completedAt = time()
  Print(message)

  if reload then
    local api = GetAPI()
    if api and api.SaveReload then
      api.SaveReload()
    else
      Print("Could not reload automatically because AscensionScraperAPI is unavailable. Run /scrap save once.")
    end
  end
end

local function StartNextWindow(api)
  local state = DB.state
  local config = DB.config
  local total = KnownTotal(api)

  if total <= 0 then
    state.enabled = false
    state.phase = "blocked"
    Print("KnownItems.lua is not loaded or has no IDs. Regenerate it, sync the addon, reload, then run /scrapauto known.")
    return
  end

  local offset = ClampNumber(state.offset, config.offset, 1)
  local chunkSize = ClampNumber(config.chunkSize, DEFAULTS.chunkSize, 1)
  local skippedThisTick = 0

  while skippedThisTick < 100 do
    if offset > total then
      MarkDone("Known item automation complete. Copy WTF/Account/<ACCOUNT>/SavedVariables/AscensionScraper.lua after this final save/reload if one just happened.", false)
      return
    end

    local info = api.GetKnownItemWindowInfo(config.mode, offset, chunkSize)
    if not info or (tonumber(info.sourceWindowCount) or 0) <= 0 then
      MarkDone("Known item automation complete. Copy WTF/Account/<ACCOUNT>/SavedVariables/AscensionScraper.lua after this final save/reload if one just happened.", false)
      return
    end

    if (tonumber(info.scanCount) or 0) > 0 then
      state.offset = offset
      state.phase = "scanning"
      state.currentScanCount = info.scanCount
      state.currentWindowCount = info.sourceWindowCount
      state.expectedNextOffset = info.nextOffset
      state.startedChunkAt = time()

      local started = api.StartKnownItemScan(config.batch, config.mode, offset, chunkSize)
      if started then
        Print("Scanning known-item chunk at offset " .. offset .. " (" .. info.scanCount .. " IDs to capture from " .. info.sourceWindowCount .. " known IDs).")
        return
      end

      offset = math.max(tonumber(info.nextOffset) or (offset + chunkSize), offset + 1)
      state.offset = offset
    else
      offset = math.max(tonumber(info.nextOffset) or (offset + chunkSize), offset + 1)
      state.offset = offset
      state.windowsSkipped = (state.windowsSkipped or 0) + 1
      skippedThisTick = skippedThisTick + 1
    end
  end

  state.phase = "skipping"
  Print("Skipped " .. skippedThisTick .. " known-item windows that already had tooltip data. Continuing automatically.")
end

local function Tick(force)
  EnsureDB()

  if readyAt and GetTime and GetTime() < readyAt and not force then
    return
  end

  local state = DB.state
  if not state.enabled then
    return
  end

  local api = GetAPI()
  if not api then
    if not missingApiWarned then
      Print("Waiting for AscensionScraperAPI. Make sure AscensionScraper is enabled too.")
      missingApiWarned = true
    end
    return
  end
  missingApiWarned = false

  local session = api.GetSessionState and api.GetSessionState() or {}
  if session.active then
    return
  end

  if state.phase == "scanning" then
    local progress = api.GetKnownItemProgress and api.GetKnownItemProgress() or nil
    if progress and progress.complete then
      if DB.config.useShards then
        local shard = ClampNumber(state.nextShard, 1, 1)
        local maxShards = ClampNumber(DB.config.maxShards, DEFAULTS.maxShards, 1)
        if shard > maxShards then
          state.enabled = false
          state.phase = "blocked"
          Print("No shard addon left for chunk " .. shard .. ". Add more AscensionScraperShard addons or restart with a larger chunk size.")
          return
        end

        if not api.FlushKnownItemChunkToShard then
          state.enabled = false
          state.phase = "blocked"
          Print("AscensionScraper is missing shard support. Update/sync AscensionScraper and reload.")
          return
        end

        local flushed = api.FlushKnownItemChunkToShard(shard, DB.config.clearMainAfterShard)
        if not flushed or not flushed.ok then
          state.enabled = false
          state.phase = "blocked"
          Print("Could not write shard " .. shard .. ": " .. tostring(flushed and flushed.reason or "unknown error"))
          return
        end

        state.lastShardDb = flushed.dbName
        state.lastShardItemCount = flushed.count
        state.nextShard = shard + 1
        Print("Moved " .. tostring(flushed.count) .. " item records into " .. tostring(flushed.dbName) .. ".")
      end

      local nextOffset = tonumber(progress.nextOffset) or tonumber(state.expectedNextOffset) or (tonumber(state.offset) or 1) + (tonumber(DB.config.chunkSize) or DEFAULTS.chunkSize)
      state.offset = math.max(nextOffset, (tonumber(state.offset) or 1) + 1)
      state.chunksDone = (state.chunksDone or 0) + 1
      state.lastChunkCompletedAt = time()

      local total = KnownTotal(api)
      if total > 0 and state.offset > total then
        state.enabled = false
        state.done = true
        state.phase = "done"
        state.completedAt = time()
        Print("Final known-item chunk complete. Reloading once more so WoW writes the finished AscensionScraperDB.")
      else
        state.phase = "saving"
        Print("Chunk complete. Reloading so WoW writes SavedVariables, then automation will resume at offset " .. state.offset .. ".")
      end

      if api.SaveReload then
        api.SaveReload()
      else
        Print("Could not reload automatically. Run /scrap save, then /scrapauto resume.")
      end
      return
    end

    state.phase = "paused"
    Print("The known-item scan stopped before completing the chunk. Use /scrapauto resume to continue.")
    return
  end

  StartNextWindow(api)
end

local function StartAutomation(batch, mode, chunkSize, offset)
  EnsureDB()

  DB.config.batch = ClampNumber(batch, DB.config.batch or DEFAULTS.batch, 1)
  DB.config.mode = NormalizeMode(mode or DB.config.mode or DEFAULTS.mode)
  DB.config.chunkSize = ClampNumber(chunkSize, DB.config.chunkSize or DEFAULTS.chunkSize, 1)
  DB.config.offset = ClampNumber(offset, DB.state.offset or DB.config.offset or DEFAULTS.offset, 1)

  DB.state.enabled = true
  DB.state.done = false
  DB.state.phase = "idle"
  DB.state.offset = DB.config.offset
  DB.state.nextShard = 1
  DB.state.startedAt = time()
  DB.state.completedAt = nil
  DB.state.chunksDone = DB.state.chunksDone or 0
  DB.state.windowsSkipped = DB.state.windowsSkipped or 0

  Print("Automation enabled: /scrap known " .. DB.config.batch .. " " .. DB.config.mode .. " <offset> " .. DB.config.chunkSize .. ", with shard save/reload after each chunk.")
  Tick(true)
end

local function ResumeAutomation()
  EnsureDB()
  DB.state.enabled = true
  DB.state.done = false
  if DB.state.phase == "done" or DB.state.phase == "blocked" then
    DB.state.phase = "idle"
  end
  Print("Automation resumed at offset " .. tostring(DB.state.offset) .. ".")
  Tick(true)
end

local function StopAutomation()
  EnsureDB()
  DB.state.enabled = false
  DB.state.phase = "stopped"
  Print("Automation stopped. Current offset is " .. tostring(DB.state.offset) .. ".")
end

local function Help()
  Print("Commands:")
  Print("/scrapauto known [batch] [all|missing] [chunkSize] [offset] - automate KnownItems.lua tooltip scraping. Default chunk is 20000.")
  Print("/scrapauto resume - resume from the saved offset.")
  Print("/scrapauto stop - stop automation after the current action.")
  Print("/scrapauto status - show automation state.")
end

local function HandleSlash(message)
  EnsureDB()

  local args = SplitWords(message)
  local command = string.lower(args[1] or "")

  if command == "known" or command == "start" then
    StartAutomation(args[2], args[3], args[4], args[5])
  elseif command == "resume" then
    ResumeAutomation()
  elseif command == "stop" or command == "pause" then
    StopAutomation()
  elseif command == "status" or command == "" then
    Status()
  else
    Help()
  end
end

local function OnEvent(_, event, ...)
  if event == "ADDON_LOADED" then
    local loadedAddon = ...
    if loadedAddon == ADDON_NAME then
      EnsureDB()
      Print("Loaded. Use /scrapauto known to automate known-item scraping.")
    end
  elseif event == "PLAYER_LOGIN" then
    readyAt = GetTime() + 2
    EnsureDB()
    if DB.state.done and DB.state.phase == "done" then
      Print("Known-item automation is complete. Copy the AscensionScraper SavedVariables file when ready.")
    elseif DB.state.enabled then
      Print("Automation is enabled and will resume at offset " .. tostring(DB.state.offset) .. ".")
    end
  end
end

frame:SetScript("OnEvent", OnEvent)
frame:SetScript("OnUpdate", function(_, elapsed)
  tickElapsed = tickElapsed + elapsed
  if tickElapsed < (DB and DB.config and DB.config.tickSeconds or DEFAULTS.tickSeconds) then
    return
  end
  tickElapsed = 0
  Tick(false)
end)
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_LOGIN")

SLASH_ASCENSIONSCRAPERAUTO1 = "/scrapauto"
SLASH_ASCENSIONSCRAPERAUTO2 = "/scrap-auto"
SlashCmdList.ASCENSIONSCRAPERAUTO = HandleSlash
