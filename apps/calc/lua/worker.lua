-- worker.lua
-- Long-lived headless Path of Building (PoE2) worker for Astrolabe.
--
-- Boots PoB once through PoB's own HeadlessWrapper.lua and then answers
-- JSON-RPC 2.0 requests, one JSON object per line on stdin. Every response is
-- written as one line on stdout prefixed with RESPONSE_MARKER, because PoB
-- itself may write log lines to stdout. Everything PoB prints through print()
-- is redirected to stderr.
--
-- Usage (cwd must be PoB's src/ directory; the Node supervisor does this):
--   luajit worker.lua <workerLuaDir> <init.json>
--
-- init.json (written by the supervisor):
--   { "protocolVersion": 1, "dataReleaseId": "..." | null, "dataHash": "...",
--     "luaGc": { "pause": 150, "stepmul": 200 },
--     "profiles": { "<id>": { "hash": "...", "config": [ { "key": "...", "value": ... } ] } } }
--
-- The worker handles build XML only. Build codes are decoded and encoded by
-- the supervisor, because PoB's headless Inflate/Deflate are empty stubs.
-- Every number in a result is taken from PoB's own output; nothing here
-- calculates game values.

local workerDir, initPath = ...
workerDir = workerDir or arg[1]
initPath = initPath or arg[2]

local RESPONSE_MARKER = "@@ASTROLABE_RPC@@"
local PROTOCOL_VERSION = 1

package.path = workerDir .. "/?.lua;../runtime/lua/?.lua;../runtime/lua/?/init.lua;" .. package.path

local realStdout = io.stdout
local stderr = io.stderr

-- PoB logs through print()/ConPrintf(). Send all of it to stderr and, while a
-- build is loading, also collect it as load warnings.
local capture = nil
local MAX_CAPTURED = 200
print = function(...)
	local parts = {}
	for i = 1, select("#", ...) do
		parts[#parts + 1] = tostring((select(i, ...)))
	end
	local line = table.concat(parts, "\t")
	stderr:write(line, "\n")
	if capture then
		if #capture < MAX_CAPTURED then
			capture[#capture + 1] = line
		elseif #capture == MAX_CAPTURED then
			capture[#capture + 1] = "(further Path of Building messages left out)"
		end
	end
end

local function writeLine(tbl, json)
	realStdout:write(RESPONSE_MARKER, json.encode(tbl), "\n")
	realStdout:flush()
end

local okJson, dkjson = pcall(require, "dkjson")
if not okJson then
	stderr:write("worker: cannot load dkjson: ", tostring(dkjson), "\n")
	os.exit(2)
end

local function readFile(path)
	local f, err = io.open(path, "rb")
	if not f then
		error("cannot read " .. tostring(path) .. ": " .. tostring(err))
	end
	local s = f:read("*a")
	f:close()
	return s
end

local init = dkjson.decode(readFile(initPath))
if type(init) ~= "table" or init.protocolVersion ~= PROTOCOL_VERSION then
	stderr:write("worker: init file missing or for another protocol version\n")
	os.exit(2)
end

-- Boot PoB. HeadlessWrapper defines the globals `build`, `launch`,
-- `loadBuildFromXML()` and `runCallback()`.
dofile("HeadlessWrapper.lua")
if build == nil then
	-- HeadlessWrapper returns early when PoB shows a startup error.
	writeLine({ jsonrpc = "2.0", id = dkjson.null, error = {
		code = -32000,
		message = "Path of Building failed to start",
		data = { kind = "worker_crashed", detail = tostring(launch and launch.promptMsg or "unknown startup error") },
	} }, dkjson)
	os.exit(3)
end

local sha2 = require("sha2")
-- Each build load leaves a lot of garbage; LuaJIT's default pause lets the
-- heap double before collecting (measured: ~900 MB per worker). The supervisor
-- passes a tighter setting from config/calc/pool.json.
if type(init.luaGc) == "table" then
	collectgarbage("setpause", init.luaGc.pause)
	collectgarbage("setstepmul", init.luaGc.stepmul)
end

-- Without a published data release (local development) the supervisor passes
-- no id; the worker then reports revision 0, which no published release uses.
local dataReleaseId = init.dataReleaseId
if type(dataReleaseId) ~= "string" then
	if type(latestTreeVersion) ~= "string" then
		writeLine({ jsonrpc = "2.0", id = dkjson.null, error = {
			code = -32000,
			message = "Path of Building declares no tree version",
			data = { kind = "worker_crashed", detail = "latestTreeVersion missing; cannot name the local data release" },
		} }, dkjson)
		os.exit(3)
	end
	dataReleaseId = "poe2-" .. latestTreeVersion:gsub("_", ".") .. "+r0"
end
local varList = LoadModule("Modules/ConfigOptions")
local varByName = {}
for _, varData in ipairs(varList) do
	if varData.var then
		varByName[varData.var] = varData
	end
end

-- ---------------------------------------------------------------- helpers

local RpcError = {}
RpcError.__index = RpcError

local CODES = {
	invalid_params = -32602,
	unknown_method = -32601,
}

local function fail(kind, message, detail)
	error(setmetatable({ kind = kind, message = message, detail = detail }, RpcError), 0)
end

local function isFiniteNumber(v)
	return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge
end

local function utcNow()
	return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function gameVersion()
	-- PoB declares the newest tree version it supports, e.g. "0_5".
	local v = latestTreeVersion
	if type(v) ~= "string" then
		return nil
	end
	return (v:gsub("_", "."))
end

local function takePrompt()
	local msg = launch.promptMsg
	launch.promptMsg = nil
	if msg then
		return (tostring(msg):gsub("%^x%x%x%x%x%x%x", ""):gsub("%^%d", ""))
	end
	return nil
end

-- ---------------------------------------------------------------- build state

-- Loaded build states by handle. States are immutable: the XML stored here
-- never changes after build.load.
local states = {}
local nextHandle = 1
-- What is currently loaded into PoB's single build object.
local current = nil -- { handle, profile, mainSkill }

local function checkBuildXml(xmlText)
	local dom, err = common.xml.ParseXML(xmlText)
	if err or type(dom) ~= "table" or type(dom[1]) ~= "table" then
		fail("build_load_failed", "Build XML is not valid XML", err and tostring(err) or "no root element")
	end
	local root = dom[1].elem
	if root == "PathOfBuilding" then
		fail("build_load_failed", "This is a Path of Exile 1 build. Only PoE2 builds are supported.")
	end
	if root ~= "PathOfBuilding2" then
		fail("build_load_failed", "Not a Path of Building (PoE2) build", "root element <" .. tostring(root) .. ">")
	end
	local hasBuild = false
	for _, node in ipairs(dom[1]) do
		if type(node) == "table" and node.elem == "Build" then
			hasBuild = true
		end
	end
	if not hasBuild then
		fail("build_load_failed", "Not a Path of Building (PoE2) build", "<Build> element missing")
	end
end

local function loadIntoPob(xmlText)
	current = nil
	takePrompt()
	capture = {}
	local ok, err = pcall(function()
		loadBuildFromXML(xmlText, "Astrolabe")
		-- second frame so all deferred recalculations have run
		runCallback("OnFrame")
	end)
	local captured = capture
	capture = nil
	if not ok then
		fail("build_load_failed", "Path of Building could not load the build", tostring(err))
	end
	local prompt = takePrompt()
	if prompt then
		fail("build_load_failed", "Path of Building could not load the build", prompt)
	end
	return captured
end

-- Checks one Config tab option against PoB's own option list
-- (Modules/ConfigOptions.lua) and returns a message when it does not fit.
local INTEGER_TYPES = { count = true, integer = true, countAllowZero = true }
local function configValueProblem(key, v, isOverride)
	local varData = varByName[key]
	if not varData then
		return "Path of Building has no config option " .. tostring(key)
	end
	local t = varData.type
	-- Free text (e.g. custom mods) would let any mod line into a calculation without a catalog id.
	if isOverride and t == "text" then
		return "config option " .. key .. " takes free text and cannot be overridden"
	end
	local valid
	if t == "check" then
		valid = type(v) == "boolean"
	elseif INTEGER_TYPES[t] then
		valid = type(v) == "number" and v == math.floor(v)
	elseif t == "float" then
		valid = type(v) == "number"
	elseif t == "list" then
		valid = false
		for _, item in ipairs(varData.list or {}) do
			if item.val == v then
				valid = true
			end
		end
	elseif t == "text" then
		valid = type(v) == "string"
	end
	if not valid then
		return "invalid value for config option " .. key .. " (" .. tostring(t) .. ")"
	end
	return nil
end

local function configInput()
	return build.configTab.configSets[build.configTab.activeConfigSetId].input
end

-- Keys of an overrides table in a fixed order, so applying and hashing do not depend on pairs().
local function sortedOverrides(overrides)
	local keys = {}
	for key in pairs(overrides or {}) do
		keys[#keys + 1] = key
	end
	table.sort(keys)
	return keys
end

-- Canonical text of the overrides; part of the calc id and of the load cache key.
-- Every part is length-prefixed, so no value can imitate another key, and
-- numbers keep all 17 significant digits.
local function overridesKey(overrides)
	local parts = {}
	for _, key in ipairs(sortedOverrides(overrides)) do
		local value = overrides[key]
		local text = type(value) == "number" and string.format("%.17g", value) or tostring(value)
		parts[#parts + 1] = string.format("%d:%s=%s:%d:%s", #key, key, type(value), #text, text)
	end
	return table.concat(parts, ";")
end

-- Applies the profile's options, then the player's overrides (which win).
local function applyProfile(profileId, overrides)
	local profile = init.profiles and init.profiles[profileId]
	if not profile then
		fail("invalid_params", "Unknown calc profile", profileId)
	end
	local keys = sortedOverrides(overrides)
	if #profile.config == 0 and #keys == 0 then
		return profile
	end
	local input = configInput()
	for _, entry in ipairs(profile.config) do
		local problem = configValueProblem(entry.key, entry.value)
		if problem then
			fail("invalid_params", "Calc profile does not fit Path of Building", profileId .. ": " .. problem)
		end
		input[entry.key] = entry.value
	end
	for _, key in ipairs(keys) do
		local problem = configValueProblem(key, overrides[key], true)
		if problem then
			fail("invalid_params", "Config override does not fit Path of Building", problem)
		end
		input[key] = overrides[key]
	end
	build.configTab:BuildModList()
	build.buildFlag = true
	return profile
end

-- Main skill = PoB's socket group label (the name in PoB's main skill
-- dropdown: the user's label or the group's active skills). calc.stats
-- reports the same label back, so a result's mainSkill can be passed in again.
local function groupLabel(group)
	return group and (group.displayLabel or group.label) or nil
end

local function selectMainSkill(mainSkill)
	if not mainSkill then
		return
	end
	local labels, matches = {}, {}
	for index, group in ipairs(build.skillsTab.socketGroupList) do
		local label = groupLabel(group)
		if label == mainSkill then
			matches[#matches + 1] = index
		end
		if label then
			labels[#labels + 1] = label
		end
	end
	if #matches == 0 then
		fail("invalid_params", "Main skill not found in the build", mainSkill .. "; available: " .. table.concat(labels, ", "))
	end
	if #matches > 1 then
		fail("invalid_params", "Main skill is ambiguous: several skill groups have this label", mainSkill)
	end
	build.mainSocketGroup = matches[1]
	build.buildFlag = true
end

local function getState(handle)
	local state = states[handle]
	if not state then
		fail("unknown_handle", "Unknown build handle", tostring(handle))
	end
	return state
end

-- Loads a state into PoB with the given profile and main skill (nil = as saved).
local function ensureLoaded(handle, profileId, mainSkill, overrides)
	local state = getState(handle)
	local overridesText = overridesKey(overrides)
	-- A profile without options and no overrides leave the build exactly as loaded.
	if
		profileId
		and init.profiles[profileId]
		and #init.profiles[profileId].config == 0
		and overridesText == ""
	then
		profileId = nil
	end
	if
		current
		and current.handle == handle
		and current.profile == profileId
		and current.mainSkill == mainSkill
		and current.overrides == overridesText
	then
		return state
	end
	loadIntoPob(state.xml)
	local ok, err = pcall(function()
		if profileId then
			applyProfile(profileId, overrides)
		end
		selectMainSkill(mainSkill)
		runCallback("OnFrame")
	end)
	if not ok then
		error(err, 0)
	end
	local prompt = takePrompt()
	if prompt then
		fail("calc_failed", "Path of Building reported an error", prompt)
	end
	current = { handle = handle, profile = profileId, mainSkill = mainSkill, overrides = overridesText }
	return state
end

-- ---------------------------------------------------------------- results

local function currentMainSkill()
	return groupLabel(build.skillsTab.socketGroupList[build.mainSocketGroup])
end

local function stripColors(text)
	return (tostring(text):gsub("%^x%x%x%x%x%x%x", ""):gsub("%^%d", ""))
end

local MOD_LINE_LISTS = { "buffModLines", "enchantModLines", "runeModLines", "implicitModLines", "explicitModLines" }

local function collectUnsupported()
	local out, seen = {}, {}
	local function add(line)
		if type(line) == "string" and line ~= "" and not seen[line] then
			seen[line] = true
			out[#out + 1] = line
		end
	end
	for _, slot in pairs(build.itemsTab.slots or {}) do
		local item = slot.selItemId and slot.selItemId ~= 0 and build.itemsTab.items[slot.selItemId]
		if item and not slot.nodeId then
			for _, listName in ipairs(MOD_LINE_LISTS) do
				for _, modLine in ipairs(item[listName] or {}) do
					if modLine.extra and (not item.CheckModLineVariant or item:CheckModLineVariant(modLine)) then
						add(modLine.line)
					end
				end
			end
		end
	end
	for _, node in pairs(build.spec and build.spec.allocNodes or {}) do
		-- Same rule as PoB's tree tooltip: a line is unsupported when PoB
		-- found no mods for it or only part of it.
		for i, line in ipairs(node.sd or {}) do
			local mod = node.mods and node.mods[i]
			if mod and (mod.extra or not mod.list) then
				add(line)
			end
		end
	end
	table.sort(out)
	return out
end

local function collectStats(warnings)
	local stats = {}
	local nonFinite = {}
	local output = build.calcsTab.mainOutput
	if type(output) ~= "table" or next(output) == nil then
		fail("calc_failed", "Path of Building produced no output for this build")
	end
	for key, value in pairs(output) do
		if type(key) == "string" and type(value) == "number" then
			if isFiniteNumber(value) then
				stats[key] = value
			else
				nonFinite[#nonFinite + 1] = key .. "=" .. tostring(value)
			end
		end
	end
	-- PoB sets ReqStr/ReqDex/ReqInt only when something asks for more than zero, but always
	-- sets the matching "<name>String" marker once the requirement block ran (CalcPerform.lua).
	-- Marker present and requirement absent means "no requirement", i.e. zero.
	for _, key in ipairs({ "ReqStr", "ReqDex", "ReqInt" }) do
		if stats[key] == nil and output[key .. "String"] == 0 then
			stats[key] = 0
		end
	end
	if #nonFinite > 0 then
		table.sort(nonFinite)
		warnings[#warnings + 1] = "Path of Building returned non-finite values (left out of stats): " .. table.concat(nonFinite, ", ")
	end
	return stats
end

local function buildWarnings()
	local out = {}
	local control = build.controls.warnings
	if not (control and type(control.lines) == "table") then
		fail("calc_failed", "Path of Building's warning list is missing", "build.controls.warnings.lines")
	end
	for _, line in pairs(control.lines) do
		out[#out + 1] = stripColors(line)
	end
	table.sort(out)
	return out
end

-- ---------------------------------------------------------------- methods

local function addState(xmlText)
	local handle = "w" .. nextHandle
	nextHandle = nextHandle + 1
	states[handle] = { xml = xmlText, inputHash = sha2.sha256(xmlText) }
	return handle
end

local methods = {}

methods["meta.version"] = function()
	local gv = gameVersion()
	if not gv then
		fail("calc_failed", "Path of Building declares no tree version")
	end
	return {
		protocolVersion = PROTOCOL_VERSION,
		pobVersion = tostring(launch.versionNumber),
		gameVersion = gv,
		dataReleaseId = dataReleaseId,
		dataHash = init.dataHash,
	}
end

methods["build.load"] = function(params)
	if params.format ~= "xml" then
		fail("invalid_params", "The worker only loads build XML; the supervisor decodes build codes", tostring(params.format))
	end
	local xmlText = params.payload
	if type(xmlText) ~= "string" or xmlText == "" then
		fail("invalid_params", "payload must be a non-empty string")
	end
	checkBuildXml(xmlText)
	local warnings = loadIntoPob(xmlText)
	local handle = addState(xmlText)
	current = { handle = handle }
	return { handle = handle, warnings = warnings }
end

methods["build.export"] = function(params)
	if params.format ~= "xml" then
		fail("invalid_params", "The worker only exports build XML; the supervisor encodes build codes", tostring(params.format))
	end
	-- Exactly the XML the state's inputHash was taken from: exporting and
	-- loading it again gives the same inputHash and calcId.
	return { payload = getState(params.handle).xml }
end

-- ---------------------------------------------------------------- patches
--
-- Each op uses the same PoB functions as the matching GUI control, so a
-- patched build is what a player would get by clicking. A failed op aborts
-- the whole patch; the stored state is never touched (states are immutable).

local MAX_LEVEL = 100 -- PoB's own level limit (Modules/Build.lua, characterLevel control)

local function nodeById(id)
	local node = build.spec.nodes[tonumber(id)]
	if not node then
		fail("invalid_params", "Passive node not in this tree version", tostring(id))
	end
	return node
end

-- Groups are addressed by their label, like the main skill. A label shared by
-- several groups is ambiguous and rejected instead of silently taking the first.
local function findGroup(groupKey)
	local found, foundGroup
	for index, group in ipairs(build.skillsTab.socketGroupList) do
		if (group.displayLabel or group.label) == groupKey then
			if found then
				fail("invalid_params", "Several skill groups have this label", groupKey)
			end
			found, foundGroup = index, group
		end
	end
	return found, foundGroup
end

-- The catalog names a gem by PoB's gameId, but PoB's gem table is keyed by its own
-- table key (they differ for most support gems), so look the gem up by gameId.
local gemsByGameId, gemsByGameIdSource
local function gemByGameId(gameId)
	if gemsByGameIdSource ~= build.data.gems then
		gemsByGameId, gemsByGameIdSource = {}, build.data.gems
		for _, gem in pairs(build.data.gems) do
			if gem.gameId then
				gemsByGameId[gem.gameId] = gem
			end
		end
	end
	return gemsByGameId[gameId]
end

local function gemInstance(spec, wantSupport)
	local gemData = gemByGameId(spec.gemId)
	if not gemData or not gemData.grantedEffect then
		fail("invalid_params", "Gem not in Path of Building's data", tostring(spec.gemId))
	end
	if (gemData.grantedEffect.support and true or false) ~= wantSupport then
		fail("invalid_params", wantSupport and "Gem is not a support gem" or "Gem is a support gem, not an active skill", spec.gemId)
	end
	return {
		gemId = gemData.id,
		skillId = gemData.grantedEffectId,
		nameSpec = gemData.nameSpec or gemData.name,
		level = spec.level,
		quality = spec.quality,
		enabled = true,
		enableGlobal1 = true,
		enableGlobal2 = false,
		count = 1,
		corruptLevel = 0,
		statSet = {},
		statSetCalcs = {},
		skillMinionSkillStatSetIndexLookup = {},
		skillMinionSkillStatSetIndexLookupCalcs = {},
	}
end

local function itemSlot(slotName)
	local slot = build.itemsTab.slots[slotName]
	if not slot then
		fail("invalid_params", "Path of Building has no item slot with this name", tostring(slotName))
	end
	return slot
end

local patchOps = {}

patchOps.setLevel = function(op)
	if op.level > MAX_LEVEL then
		fail("invalid_params", "Level above Path of Building's maximum", tostring(op.level))
	end
	build.characterLevel = op.level
	build.characterLevelAutoMode = false
	build.controls.characterLevel:SetText(build.characterLevel)
	build.configTab:BuildModList()
end

patchOps.setClass = function(op, warnings)
	local classId = build.spec.tree.classNameMap[op.classId]
	if not classId then
		fail("invalid_params", "Class not in this tree version", tostring(op.classId))
	end
	if classId == build.spec.curClassId then
		return
	end
	if build.spec:CountAllocNodes() > 0 and not build.spec:IsClassConnected(classId) then
		warnings[#warnings + 1] = "Class change to " .. op.classId .. " left passives that do not connect to its start; Path of Building dropped them"
	end
	build.spec:SelectClass(classId)
end

patchOps.setAscendancy = function(op)
	for ascendId, ascend in pairs(build.spec.curClass.classes) do
		if ascend.internalId == op.ascendancyId then
			build.spec:SelectAscendClass(ascendId)
			return
		end
	end
	fail("invalid_params", "Ascendancy does not belong to the build's class", tostring(op.ascendancyId))
end

patchOps.allocateNodes = function(op, warnings)
	local spec = build.spec
	-- PoB knows the weapon sets 1 and 2 (PassiveSpec allocMode); 0 is the shared tree.
	if op.weaponSet ~= nil and op.weaponSet ~= 0 and op.weaponSet ~= 1 and op.weaponSet ~= 2 then
		fail("invalid_params", "Path of Building only knows weapon sets 1 and 2", tostring(op.weaponSet))
	end
	spec.allocMode = op.weaponSet or 0
	for _, id in ipairs(op.nodeIds) do
		local node = nodeById(id)
		if node.alloc then
			-- Already allocated: PoB keeps the node as it is (keystones, ascendancy
			-- and sockets are always set-less), so say so instead of doing nothing.
			if (node.allocMode or 0) ~= spec.allocMode then
				warnings[#warnings + 1] = "Passive node " .. tostring(id) .. " was already allocated in another weapon set or none; left unchanged"
			end
		else
			spec:AllocNode(node)
			if not node.alloc then
				spec.allocMode = 0
				fail("invalid_params", "Passive node cannot be connected to the tree", tostring(id))
			end
			if (node.allocMode or 0) ~= spec.allocMode then
				warnings[#warnings + 1] = "Passive node " .. tostring(id) .. " cannot belong to a weapon set (keystone, socket or ascendancy); allocated without one"
			end
		end
	end
	spec.allocMode = 0
end

patchOps.deallocateNodes = function(op)
	for _, id in ipairs(op.nodeIds) do
		local node = nodeById(id)
		if node.alloc then
			build.spec:DeallocNode(node)
		end
	end
end

patchOps.setSkill = function(op)
	if op.weaponSet ~= nil then
		fail("invalid_params", "weaponSet for skill groups is not supported by Path of Building", op.groupKey)
	end
	local gems = { gemInstance(op, false) }
	for _, support in ipairs(op.supports) do
		gems[#gems + 1] = gemInstance(support, true)
	end
	local group = {
		enabled = true,
		label = op.groupKey,
		mainActiveSkill = 1,
		mainActiveSkillCalcs = 1,
		gemList = gems,
	}
	build.skillsTab:ProcessSocketGroup(group)
	local index, old = findGroup(op.groupKey)
	if index then
		if old.source then
			fail("invalid_params", "This skill group is created by an equipped item and cannot be replaced", op.groupKey)
		end
		build.skillsTab.socketGroupList[index] = group
	else
		table.insert(build.skillsTab.socketGroupList, group)
	end
end

patchOps.removeSkill = function(op)
	local index = findGroup(op.groupKey)
	if not index then
		fail("invalid_params", "No skill group with this key", op.groupKey)
	end
	local list = build.skillsTab.socketGroupList
	if list[index].source then
		fail("invalid_params", "This skill group is created by an equipped item and cannot be removed", op.groupKey)
	end
	table.remove(list, index)
	-- Same bookkeeping as PoB's skill list control when a group is deleted.
	if build.mainSocketGroup > index then
		build.mainSocketGroup = build.mainSocketGroup - 1
	end
	local input = build.calcsTab.input
	if input.skill_number and input.skill_number > index then
		input.skill_number = input.skill_number - 1
	end
	if build.mainSocketGroup > #list then
		build.mainSocketGroup = math.max(1, #list)
	end
end

patchOps.setItem = function(op)
	local slot = itemSlot(op.slot)
	local item = new("Item", op.itemText)
	if not item.base then
		fail("invalid_params", "Path of Building could not read the item text", op.slot)
	end
	if not build.itemsTab:IsItemValidForSlot(item, op.slot) then
		fail("invalid_params", "Item does not fit this slot", op.slot .. ": " .. tostring(item.baseName))
	end
	build.itemsTab:AddItem(item, true)
	slot:SetSelItemId(item.id)
	build.itemsTab:PopulateSlots()
end

patchOps.removeItem = function(op)
	itemSlot(op.slot):SetSelItemId(0)
	build.itemsTab:PopulateSlots()
end

patchOps.setConfig = function(op)
	local problem = configValueProblem(op.key, op.value)
	if problem then
		fail("invalid_params", problem)
	end
	configInput()[op.key] = op.value
	build.configTab:BuildModList()
end

methods["build.applyPatch"] = function(params)
	if type(params.ops) ~= "table" or #params.ops == 0 then
		fail("invalid_params", "ops must be a non-empty list")
	end
	ensureLoaded(params.handle, nil, nil)
	-- From here on PoB holds a changed build; any failure must not leave it
	-- marked as the stored state.
	current = nil
	local warnings = {}
	for i, op in ipairs(params.ops) do
		local where = "op " .. i .. " (" .. tostring(op.op) .. ")"
		local apply = patchOps[op.op]
		if not apply then
			fail("invalid_params", "Unknown patch op", where)
		end
		local ok, err = pcall(apply, op, warnings)
		if not ok then
			if getmetatable(err) ~= RpcError then
				err = setmetatable({ kind = "calc_failed", message = "Path of Building raised an error", detail = debug.traceback(tostring(err), 2) }, RpcError)
			end
			err.detail = where .. (err.detail and ": " .. err.detail or "")
			error(err, 0)
		end
	end
	build.buildFlag = true
	runCallback("OnFrame")
	local prompt = takePrompt()
	if prompt then
		fail("calc_failed", "Path of Building reported an error after the patch", prompt)
	end
	local handle = addState(build:SaveDB("Astrolabe"))
	-- PoB now holds the patched object, but numbers must belong to the stored
	-- XML (the hash). Leaving current unset makes the next calc load that XML,
	-- so memory state and export/reload can never differ.
	current = nil
	return { handle = handle, warnings = setmetatable(warnings, { __jsontype = "array" }) }
end

-- Worker-internal (not part of the contract): a fresh build of one class as
-- Path of Building creates it (empty tree, no items, no skills), exported as
-- XML. The supervisor offers it as the starting point for BuildState diffs.
methods["build.template"] = function(params)
	if type(params.classId) ~= "string" then
		fail("invalid_params", "classId is required")
	end
	current = nil
	takePrompt()
	local ok, err = pcall(function()
		newBuild() -- runs its own frame
	end)
	if not ok then
		fail("calc_failed", "Path of Building could not start a new build", tostring(err))
	end
	local classId = build.spec.tree.classNameMap[params.classId]
	if not classId then
		fail("invalid_params", "Class not in this tree version", params.classId)
	end
	build.spec:SelectClass(classId)
	-- A new build levels with its passive points (auto mode); the state says
	-- level 1, so pin it, as the setLevel patch op does.
	build.characterLevel = 1
	build.characterLevelAutoMode = false
	build.controls.characterLevel:SetText(build.characterLevel)
	build.configTab:BuildModList()
	build.buildFlag = true
	runCallback("OnFrame")
	local prompt = takePrompt()
	if prompt then
		fail("calc_failed", "Path of Building reported an error for the new build", prompt)
	end
	local xmlText = build:SaveDB("Astrolabe")
	current = nil
	return { payload = xmlText }
end

-- Worker-internal (not part of the contract): the passives PoB can connect to
-- the current tree, with the number of unallocated nodes on the shortest path
-- (the node itself included). The supervisor builds calc.nodePower on it.
methods["tree.reachable"] = function(params)
	ensureLoaded(params.handle, nil, nil)
	local out = {}
	for id, node in pairs(build.spec.nodes) do
		if not node.alloc and node.path and node.type ~= "ClassStart" and node.type ~= "AscendClassStart" then
			-- Nodes in the radius of a jewel that allows unconnected allocation
			-- are allocated alone (PassiveSpec:AllocNode), the path is not.
			local cost = 0
			if #node.intuitiveLeapLikesAffecting > 0 then
				cost = 1
			else
				for _, pathNode in ipairs(node.path) do
					if not pathNode.alloc then
						cost = cost + 1
					end
				end
			end
			if cost > 0 then
				out[#out + 1] = { nodeId = tostring(id), pathCost = cost }
			end
		end
	end
	table.sort(out, function(x, y)
		return tonumber(x.nodeId) < tonumber(y.nodeId)
	end)
	return { nodes = setmetatable(out, { __jsontype = "array" }) }
end

methods["build.release"] = function(params)
	getState(params.handle)
	states[params.handle] = nil
	if current and current.handle == params.handle then
		current = nil
	end
	return setmetatable({}, { __jsontype = "object" })
end

methods["calc.stats"] = function(params)
	local profile = params.profile
	if type(profile) ~= "string" then
		fail("invalid_params", "profile is required")
	end
	local state = ensureLoaded(params.handle, profile, params.mainSkill, params.overrides)
	local warnings = buildWarnings()
	local stats = collectStats(warnings)
	local profileHash = init.profiles[profile].hash
	local pobVersion = tostring(launch.versionNumber)
	local mainSkill = currentMainSkill()
	local idParts = {
		pobVersion, dataReleaseId, init.dataHash, profile, profileHash, state.inputHash, mainSkill or "",
	}
	-- Only builds with overrides get an extra part, so ids of builds without them stay as they were.
	if overridesKey(params.overrides) ~= "" then
		idParts[#idParts + 1] = overridesKey(params.overrides)
	end
	local calcId = "calc-" .. sha2.sha256(table.concat(idParts, "\n")):sub(1, 40)
	return {
		calcId = calcId,
		pobVersion = pobVersion,
		dataReleaseId = dataReleaseId,
		calcProfile = profile,
		inputHash = state.inputHash,
		computedAt = utcNow(),
		mainSkill = mainSkill,
		overrides = overridesKey(params.overrides) ~= "" and setmetatable(params.overrides, { __jsontype = "object" }) or nil,
		stats = setmetatable(stats, { __jsontype = "object" }),
		warnings = setmetatable(warnings, { __jsontype = "array" }),
		unsupportedMods = setmetatable(collectUnsupported(), { __jsontype = "array" }),
	}
end

-- ---------------------------------------------------------------- loop

local function errorObject(kind, message, detail)
	return {
		code = CODES[kind] or -32000,
		message = message,
		data = { kind = kind, detail = detail },
	}
end

local function handleLine(line)
	local request, _, decodeErr = dkjson.decode(line)
	if type(request) ~= "table" then
		writeLine({ jsonrpc = "2.0", id = dkjson.null, error = {
			code = -32700, message = "Parse error", data = { kind = "invalid_params", detail = tostring(decodeErr) },
		} }, dkjson)
		return
	end
	local id = request.id
	if id == nil then
		id = dkjson.null
	end
	local method = methods[request.method]
	if not method then
		writeLine({ jsonrpc = "2.0", id = id, error = errorObject("unknown_method", "Method not supported by this worker", tostring(request.method)) }, dkjson)
		return
	end
	local params = type(request.params) == "table" and request.params or {}
	local ok, result = xpcall(function()
		return method(params)
	end, function(err)
		if getmetatable(err) == RpcError then
			return err
		end
		return { kind = "calc_failed", message = "Path of Building raised an error", detail = debug.traceback(tostring(err), 2) }
	end)
	if ok then
		writeLine({ jsonrpc = "2.0", id = id, result = result }, dkjson)
	else
		-- A failed load or calc can leave PoB's build object half-updated.
		current = nil
		writeLine({ jsonrpc = "2.0", id = id, error = errorObject(result.kind, result.message, result.detail) }, dkjson)
	end
end

while true do
	local line = io.read("*l")
	if line == nil then
		break
	end
	line = line:gsub("\r$", "")
	if line ~= "" then
		handleLine(line)
	end
end
