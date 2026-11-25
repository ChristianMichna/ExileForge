import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CalcPool, loadCalcProfiles, loadPoolConfig, pobInstallFromHome } from "../src/index.ts";

/*
 * Shared setup for integration tests against the real, pinned Path of
 * Building. They need tools/setup_pob.sh (or the Windows setup in CI).
 * Without PoB they are skipped, unless EXILEFORGE_REQUIRE_POB=1 (CI), where
 * a missing PoB fails.
 */

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const install = pobInstallFromHome(
  process.env.EXILEFORGE_POB_HOME ?? join(repoRoot, ".pob"),
);
export const havePob =
  existsSync(install.luajit) && existsSync(join(install.srcDir, "HeadlessWrapper.lua"));

if (process.env.EXILEFORGE_REQUIRE_POB === "1" && !havePob) {
  throw new Error(
    `EXILEFORGE_REQUIRE_POB=1 but no PoB install at ${install.srcDir} / ${install.luajit}`,
  );
}

export const golden = (id: string): Promise<string> =>
  readFile(join(repoRoot, "evals", "golden", "builds", `${id}.xml`), "utf8");

export async function startPobPool(size: number): Promise<CalcPool> {
  const config = await loadPoolConfig(join(repoRoot, "config", "calc", "pool.json"));
  return CalcPool.start({
    install,
    profiles: await loadCalcProfiles(
      fileURLToPath(new URL("./fixtures/calc-profiles", import.meta.url)),
    ),
    size,
    config,
  });
}
