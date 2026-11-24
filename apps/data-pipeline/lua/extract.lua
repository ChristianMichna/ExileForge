-- extract.lua
-- Loads Path of Building (PoE2) headless and writes its game data as raw JSON
-- shards, one file per kind. No regex parsing of Lua: PoB's own data modules are
-- executed and the resulting tables are serialized.
--
-- Usage (cwd must be PoB's src/ directory):
--   luajit extract.lua <job.json>
--
-- The job file is written by the TypeScript side (src/pob/job.ts) and lists the
-- modules to load per kind, so new data files are a config change, not code.
-- Output is deterministic: object keys are sorted, numbers use a fixed format.

local jobPath = ... or arg[1]
assert(jobPath, "usage: luajit extract.lua <job.json>")

package.path = "../runtime/lua/?.lua;../runtime/lua/?/init.lua;" .. package.path

-- HeadlessWrapper boots PoB (loads all data, builds main.uniqueDB).
dofile("HeadlessWrapper.lua")

local dkjson = require("dkjson")

local function readFile(path)
	local f = assert(io.open(path, "rb"))
	local s = f:read("*a")
	f:close()
	return s
end

local job = assert(dkjson.decode(readFile(jobPath)), "invalid job file")

---------------------------------------------------------------------------
-- Deterministic JSON encoder. Fails loudly on anything it cannot represent
-- (functions, cycles, NaN/inf) instead of dropping it silently.
---------------------------------------------------------------------------

local function isSequence(t)
	local n = 0
	for _ in pairs(t) do
		n = n + 1
	end
	for i = 1, n do
		if t[i] == nil then
			return false
		end
	end
	return true, n
end

local escapes = {
	['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f",
	["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t",
}
local function encodeString(s)
	return '"' .. s:gsub('[%c"\\]', function(c)
		return escapes[c] or string.format("\\u%04x", c:byte())
	end) .. '"'
end

local function encodeNumber(v, path)
	if v ~= v or v == math.huge or v == -math.huge then
		error("non-finite number at " .. path)
	end
	if v == math.floor(v) and math.abs(v) < 2 ^ 53 then
		return string.format("%d", v)
	end
	return string.format("%.17g", v)
end

-- PoB skill data embeds calculation functions (e.g. damage hooks). They are
-- engine logic, not catalog data; kinds that allow it get a visible marker
-- string instead, every other kind fails on a function.
local FUNCTION_MARKER = "$lua-function"
local allowFunctions = false

local encode
encode = function(v, path, stack, out)
	local t = type(v)
	if t == "function" and allowFunctions then
		out[#out + 1] = encodeString(FUNCTION_MARKER)
	elseif t == "nil" then
		out[#out + 1] = "null"
	elseif t == "boolean" then
		out[#out + 1] = v and "true" or "false"
	elseif t == "number" then
		out[#out + 1] = encodeNumber(v, path)
	elseif t == "string" then
		out[#out + 1] = encodeString(v)
	elseif t == "table" then
		if stack[v] then
			error("cycle at " .. path)
		end
		stack[v] = true
		local seq, n = isSequence(v)
		if seq and n > 0 then
			out[#out + 1] = "["
			for i = 1, n do
				if i > 1 then
					out[#out + 1] = ","
				end
				encode(v[i], path .. "/" .. (i - 1), stack, out)
			end
			out[#out + 1] = "]"
		else
			local keys = {}
			for k in pairs(v) do
				local kt = type(k)
				if kt == "number" then
					keys[#keys + 1] = encodeNumber(k, path)
				elseif kt == "string" then
					keys[#keys + 1] = k
				elseif kt == "boolean" then
					keys[#keys + 1] = tostring(k)
				else
					error("unsupported key type " .. kt .. " at " .. path)
				end
			end
			table.sort(keys)
			-- map the string form back to the original key
			local lookup = {}
			for k in pairs(v) do
				local kt = type(k)
				lookup[kt == "number" and encodeNumber(k, path) or tostring(k)] = k
			end
			out[#out + 1] = "{"
			for i, ks in ipairs(keys) do
				if i > 1 then
					out[#out + 1] = ","
				end
				out[#out + 1] = encodeString(ks)
				out[#out + 1] = ":"
				encode(v[lookup[ks]], path .. "/" .. ks, stack, out)
			end
			out[#out + 1] = "}"
		end
		stack[v] = nil
	else
		error("unsupported value type " .. t .. " at " .. path)
	end
end

local function toJson(v)
	local out = {}
	encode(v, "", {}, out)
	return table.concat(out)
end

local function writeFile(path, s)
	local f = assert(io.open(path, "wb"))
	f:write(s)
	f:close()
end

---------------------------------------------------------------------------
-- Loaders
---------------------------------------------------------------------------

local function stubMod(name, modType, value, flags, keywordFlags, ...)
	return { name = name, type = modType, value = value, flags = flags or 0, keywordFlags = keywordFlags or 0, tags = { ... } }
end
local function stubFlag(name, ...)
	return stubMod(name, "FLAG", true, 0, 0, ...)
end
local function stubSkillData(key, value, ...)
	return stubMod("SkillData", "LIST", { key = key, value = value }, 0, 0, ...)
end

-- Skill files reference the global SkillType enum; while loading them we swap
-- in a table that yields the enum *name*, so the JSON carries readable type
-- names instead of PoB-internal numbers.
local function withSkillTypeNames(fn)
	local saved = SkillType
	SkillType = setmetatable({}, {
		__index = function(_, k)
			if saved[k] == nil then
				error("unknown SkillType " .. tostring(k))
			end
			return k
		end,
	})
	local ok, err = pcall(fn)
	SkillType = saved
	if not ok then
		error(err, 0)
	end
end

-- Adds entries to a kind. The same id may come from several sources (e.g. a
-- mod listed for two domains) only if its content is identical; the source
-- tags are then collected as sorted arrays. Differing content is an error.
local function addEntities(target, kind, entries, tag)
	for id, entity in pairs(entries) do
		local existing = target[id]
		if existing ~= nil then
			if toJson(existing.content) ~= toJson(entity) then
				error(string.format("conflicting %s id %q", kind, tostring(id)))
			end
		else
			existing = { content = entity, tags = {} }
			target[id] = existing
		end
		for k, v in pairs(tag or {}) do
			existing.tags[k] = existing.tags[k] or {}
			table.insert(existing.tags[k], v)
		end
	end
end

local function finishEntities(target)
	local result = {}
	for id, e in pairs(target) do
		for k, list in pairs(e.tags) do
			table.sort(list)
			if e.content[k] ~= nil then
				error(string.format("tag %q collides with a field of %q", k, tostring(id)))
			end
			e.content[k] = list
		end
		result[id] = e.content
	end
	return result
end

local function sortedIndexKeys(t)
	local keys = {}
	for k, v in pairs(t or {}) do
		if v then
			keys[#keys + 1] = k
		end
	end
	table.sort(keys)
	return keys
end

local function modLines(lines)
	local result = {}
	for _, l in ipairs(lines) do
		result[#result + 1] = {
			line = l.line,
			modTags = l.modTags,
			variants = l.variantList and sortedIndexKeys(l.variantList) or nil,
			range = l.range,
			crafted = l.crafted or nil,
			fractured = l.fractured or nil,
		}
	end
	return result
end

local loaders = {}

-- module returns the entity map
loaders["return"] = function(src)
	return LoadModule(src.file)
end

-- module fills a table passed as first argument
loaders["fill"] = function(src)
	local t = {}
	LoadModule(src.file, t)
	return t
end

-- skill modules: fill + mod constructors
loaders["skills"] = function(src)
	local t = {}
	withSkillTypeNames(function()
		LoadModule(src.file, t, stubMod, stubFlag, stubSkillData)
	end)
	return t
end

-- uniques as parsed by PoB's own item parser (main.uniqueDB)
loaders["uniqueDB"] = function()
	local t = {}
	for key, item in pairs(main.uniqueDB.list) do
		t[key] = {
			title = item.title,
			baseName = item.baseName,
			type = item.type,
			rarity = item.rarity,
			league = item.league,
			source = item.source,
			variants = item.variantList,
			requirements = item.requirements,
			implicitModLines = modLines(item.implicitModLines),
			explicitModLines = modLines(item.explicitModLines),
		}
	end
	return t
end

-- passive tree of the given version ("latest" = PoB's latestTreeVersion).
-- Only game data is kept; art layout tables (assets, ddsCoords, ...) are dropped.
loaders["tree"] = function(src)
	local version = src.treeVersion == "latest" and latestTreeVersion or src.treeVersion
	local tree = LoadModule("TreeData/" .. version .. "/tree")
	local t = {}
	for id, node in pairs(tree.nodes) do
		t[tostring(id)] = { kind = "node", data = node }
	end
	for id, group in pairs(tree.groups) do
		t["group:" .. tostring(id)] = { kind = "group", data = group }
	end
	for index, class in pairs(tree.classes) do
		t["class:" .. class.name] = { kind = "class", index = index, data = class }
	end
	t["constants"] = { kind = "constants", data = tree.constants }
	return t, version
end

---------------------------------------------------------------------------
-- Run
---------------------------------------------------------------------------

local pobVersion = readFile("../manifest.xml"):match('<Version number="([^"]+)"')
assert(pobVersion, "PoB version not found in manifest.xml")

local meta = { pobVersion = pobVersion, latestTreeVersion = latestTreeVersion, kinds = {} }

for _, kindJob in ipairs(job.kinds) do
	local entities = {}
	for _, src in ipairs(kindJob.sources) do
		local loader = loaders[src.loader]
		if not loader then
			error("unknown loader " .. tostring(src.loader))
		end
		local entries, treeVersion = loader(src)
		if type(entries) ~= "table" then
			error(string.format("%s: %s returned no table", kindJob.kind, tostring(src.file)))
		end
		if treeVersion then
			meta.treeVersion = treeVersion
		end
		addEntities(entities, kindJob.kind, entries, src.tag)
	end
	entities = finishEntities(entities)
	local count = 0
	for _ in pairs(entities) do
		count = count + 1
	end
	if count == 0 then
		error("kind " .. kindJob.kind .. " is empty")
	end
	allowFunctions = kindJob.functions == "marker"
	writeFile(job.outDir .. "/" .. kindJob.kind .. ".json", toJson({ kind = kindJob.kind, entities = entities }))
	allowFunctions = false
	meta.kinds[kindJob.kind] = count
end

writeFile(job.outDir .. "/meta.json", toJson(meta))
print("@@EXILEFORGE_EXTRACT_OK@@")
