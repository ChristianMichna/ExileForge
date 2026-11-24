-- worker.lua
-- Long-lived headless Path of Building (PoE2) worker for ExileForge.
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

local RESPONSE_MARKER = "@@EXILEFORGE_RPC@@"
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
		loadBuildFromXML(xmlText, "ExileForge")
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

local function applyProfile(profileId)
	local profile = init.profiles and init.profiles[profileId]
	if not profile then
		fail("invalid_params", "Unknown calc profile", profileId)
	end
	if #profile.config == 0 then
		return profile
	end
	local input = build.configTab.configSets[build.configTab.activeConfigSetId].input
	for _, entry in ipairs(profile.config) do
		local varData = varByName[entry.key]
		if not varData then
			fail("invalid_params", "Calc profile sets an option Path of Building does not know", profileId .. ": " .. tostring(entry.key))
		end
		local v = entry.value
		local t = varData.type
		local valid
		if t == "check" then
			valid = type(v) == "boolean"
		elseif t == "count" or t == "integer" or t == "countAllowZero" or t == "float" then
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
			fail("invalid_params", "Calc profile sets an invalid value", profileId .. ": " .. entry.key .. " (" .. tostring(t) .. ")")
		end
		input[entry.key] = v
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
local function ensureLoaded(handle, profileId, mainSkill)
	local state = getState(handle)
	-- A profile without overrides leaves the build exactly as loaded.
	if profileId and init.profiles[profileId] and #init.profiles[profileId].config == 0 then
		profileId = nil
	end
	if current and current.handle == handle and current.profile == profileId and current.mainSkill == mainSkill then
		return state
	end
	loadIntoPob(state.xml)
	local ok, err = pcall(function()
		if profileId then
			applyProfile(profileId)
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
	current = { handle = handle, profile = profileId, mainSkill = mainSkill }
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
	local handle = "w" .. nextHandle
	nextHandle = nextHandle + 1
	states[handle] = { xml = xmlText, inputHash = sha2.sha256(xmlText) }
	current = { handle = handle }
	return { handle = handle, warnings = warnings }
end

methods["build.export"] = function(params)
	if params.format ~= "xml" then
		fail("invalid_params", "The worker only exports build XML; the supervisor encodes build codes", tostring(params.format))
	end
	ensureLoaded(params.handle, nil, nil)
	return { payload = build:SaveDB("ExileForge") }
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
	local state = ensureLoaded(params.handle, profile, params.mainSkill)
	local warnings = buildWarnings()
	local stats = collectStats(warnings)
	local profileHash = init.profiles[profile].hash
	local pobVersion = tostring(launch.versionNumber)
	local mainSkill = currentMainSkill()
	local calcId = "calc-" .. sha2.sha256(table.concat({
		pobVersion, dataReleaseId, init.dataHash, profile, profileHash, state.inputHash, mainSkill or "",
	}, "\n")):sub(1, 40)
	return {
		calcId = calcId,
		pobVersion = pobVersion,
		dataReleaseId = dataReleaseId,
		calcProfile = profile,
		inputHash = state.inputHash,
		computedAt = utcNow(),
		mainSkill = mainSkill,
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
