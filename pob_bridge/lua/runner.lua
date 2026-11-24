-- runner.lua
-- Headless entry point: loads a PoB build (XML) and prints the key stats as JSON.
--
-- Usage (cwd must be PoB's src/ directory, see pob_bridge/pob.py):
--   luajit runner.lua <bridgeLuaDir> <buildXmlPath>
--   luajit runner.lua <bridgeLuaDir> --sample "<skill line>" <outXmlPath>
--
-- The JSON result is printed on a single line prefixed with RESULT_MARKER,
-- because PoB itself writes log lines to stdout.

local bridgeDir, arg1, arg2, arg3 = ...
bridgeDir = bridgeDir or arg[1]
arg1 = arg1 or arg[2]
arg2 = arg2 or arg[3]
arg3 = arg3 or arg[4]

local RESULT_MARKER = "@@EXILEFORGE_RESULT@@"

package.path = bridgeDir .. "/?.lua;../runtime/lua/?.lua;../runtime/lua/?/init.lua;" .. package.path

-- HeadlessWrapper boots PoB (OnInit + one OnFrame) and defines `build`,
-- `newBuild()` and `loadBuildFromXML()` as globals.
dofile("HeadlessWrapper.lua")

local dkjson = require("dkjson")

local function readFile(path)
	local f = assert(io.open(path, "rb"))
	local s = f:read("*a")
	f:close()
	return s
end

local function num(v)
	if type(v) ~= "number" or v ~= v or v == math.huge or v == -math.huge then
		return nil
	end
	return v
end

-- The stats we report. Keys are PoB's own output names (CalcsTab.mainOutput).
local STAT_KEYS = {
	-- offence
	"TotalDPS", "TotalDot", "CombinedDPS", "FullDPS", "AverageHit", "Speed", "CritChance", "CritMultiplier", "HitChance",
	-- pools
	"Life", "LifeUnreserved", "EnergyShield", "Mana", "ManaUnreserved", "Spirit", "SpiritUnreserved",
	-- resistances (current value, i.e. after cap)
	"FireResist", "ColdResist", "LightningResist", "ChaosResist",
	-- resistances (uncapped totals and caps)
	"FireResistTotal", "ColdResistTotal", "LightningResistTotal", "ChaosResistTotal",
	"FireResistOverCap", "ColdResistOverCap", "LightningResistOverCap", "ChaosResistOverCap",
	-- defences
	"Armour", "Evasion", "EffectiveMovementSpeedMod", "TotalEHP",
}

local function collect()
	local out = build.calcsTab.mainOutput or {}
	local stats = {}
	for _, k in ipairs(STAT_KEYS) do
		stats[k] = num(out[k])
	end

	-- main skill name, so callers can see what the DPS refers to
	local mainSkill
	local group = build.skillsTab.socketGroupList[build.mainSocketGroup]
	if group then
		mainSkill = group.displayLabel or group.label
	end

	return {
		pobVersion = launch.versionNumber,
		build = {
			className = build.spec and build.spec.curClassName,
			ascendancy = build.spec and build.spec.curAscendClassName,
			level = build.characterLevel,
			mainSkill = mainSkill,
			treeVersion = build.spec and build.spec.treeVersion,
		},
		stats = stats,
	}
end

local function emit(tbl)
	io.stdout:write(RESULT_MARKER, dkjson.encode(tbl), "\n")
	io.stdout:flush()
end

local ok, err = pcall(function()
	if arg1 == "--sample" then
		-- Create a minimal build from scratch (used for smoke tests / fixtures).
		newBuild()
		build.itemsTab:CreateDisplayItemFromRaw("New Item\nRazor Quarterstaff")
		build.itemsTab:AddDisplayItem()
		build.skillsTab:PasteSocketGroup(arg2)
		build.mainSocketGroup = 1
		runCallback("OnFrame")
		local xml = build:SaveDB("sample")
		local f = assert(io.open(arg3, "wb"))
		f:write(xml)
		f:close()
		emit(collect())
	else
		loadBuildFromXML(readFile(arg1), "import")
		-- second frame so all deferred recalculations have run
		runCallback("OnFrame")
		emit(collect())
	end
end)

if not ok then
	emit({ error = tostring(err) })
	os.exit(1)
end
