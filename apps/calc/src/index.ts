import type { DataReleaseId } from "@exileforge/contracts";
import { join, resolve } from "node:path";
import { loadPoolConfig, resolvePoolSize } from "./config.ts";
import { pobInstallFromHome, type PobInstall } from "./install.ts";
import { CalcPool, type PoolEvent } from "./pool.ts";
import { loadCalcProfiles } from "./profiles.ts";

export { decodeBuildCode, encodeBuildCode } from "./build-code.ts";
export { autoPoolSize, loadPoolConfig, PoolConfig, resolvePoolSize } from "./config.ts";
export { computeDataHash } from "./data-hash.ts";
export { CalcServiceError, isCalcServiceError } from "./errors.ts";
export { assertPobInstall, pobInstallFromHome, WORKER_LUA, type PobInstall } from "./install.ts";
export { CalcPool, IMPLEMENTED_METHODS, type CalcPoolOptions, type PoolEvent } from "./pool.ts";
export { CalcProfileFile, loadCalcProfiles, type CalcProfile } from "./profiles.ts";
export { PobWorker, RESPONSE_MARKER } from "./worker.ts";

export interface StartCalcPoolOptions {
  /** Repository or app root holding config/calc and config/calc-profiles. */
  root: string;
  /** PoB install; default: <root>/.pob as created by tools/setup_pob.sh. */
  install?: PobInstall;
  /** Overrides config/calc/pool.json `size`. */
  size?: number;
  dataReleaseId?: DataReleaseId;
  onEvent?: (event: PoolEvent) => void;
}

/** Starts a pool with the settings and profiles from `<root>/config`. */
export async function startCalcPool(opts: StartCalcPoolOptions): Promise<CalcPool> {
  const root = resolve(opts.root);
  const config = await loadPoolConfig(join(root, "config", "calc", "pool.json"));
  const profiles = await loadCalcProfiles(join(root, "config", "calc-profiles"));
  return CalcPool.start({
    install: opts.install ?? pobInstallFromHome(join(root, ".pob")),
    profiles,
    size: opts.size ?? resolvePoolSize(config),
    config,
    ...(opts.dataReleaseId ? { dataReleaseId: opts.dataReleaseId } : {}),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
  });
}
