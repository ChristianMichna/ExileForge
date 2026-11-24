-- Regenerates tests/fixtures/witch_spark_lvl60.xml (synthetic test build, not a real player build).
-- Run from PoB src dir: LUA_CPATH="../../lib/?.so;;" ../../luajit ../../../tools/make_fixture.lua <out.xml>
local out = ...
package.path = "../runtime/lua/?.lua;../runtime/lua/?/init.lua;" .. package.path
dofile("HeadlessWrapper.lua")
newBuild()
build.characterLevelAutoMode = false
build.characterLevel = 60
build.configTab.input.resistancePenalty = -60
build.spec:SelectClass(build.spec.tree.classNameMap["Witch"] or 3)
local items = {
 "Rarity: RARE\nDoom Coat\nVile Robe\n+80 to maximum Life\n+30% to Fire Resistance\n+25% to Cold Resistance",
 "Rarity: RARE\nStorm Loop\nSapphire Ring\n+40 to maximum Life\n+35% to Lightning Resistance\n+20% to Chaos Resistance",
 "Rarity: RARE\nDire Wand\nWithered Wand\nAdds 10 to 60 Lightning Damage to Spells\n40% increased Spell Damage",
}
for _, raw in ipairs(items) do
  build.itemsTab:CreateDisplayItemFromRaw(raw)
  build.itemsTab:AddDisplayItem()
end
build.skillsTab:PasteSocketGroup("Spark 15/0  1")
build.mainSocketGroup = 1
-- allocate some passives: walk 12 nodes outward from class start
local n=0
for id, node in pairs(build.spec.nodes) do
  if n >= 12 then break end
  if node.path and not node.alloc and #node.path <= 3 and node.type == "Normal" then
    build.spec:AllocNode(node); n = n + 1
  end
end
build.spec:BuildAllDependsAndPaths()
build.buildFlag = true
runCallback("OnFrame")
local o = build.calcsTab.mainOutput
print("STATS", build.spec.curClassName, o.Life, o.FireResist, o.ColdResist, o.LightningResist, o.ChaosResist, o.CombinedDPS, n)
local f=io.open(out,"wb") f:write(build:SaveDB("fixture")) f:close()
