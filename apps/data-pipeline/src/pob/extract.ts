import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { PobSources } from "../config.ts";
import { buildExtractJob } from "./job.ts";

export const EXTRACT_LUA = fileURLToPath(new URL("../../lua/extract.lua", import.meta.url));
const OK_MARKER = "@@ASTROLABE_EXTRACT_OK@@";

/** Layout of a PoB install as created by tools/setup_pob.sh (or the Windows setup). */
export interface PobInstall {
  /** PoB-PoE2 src/ directory (contains HeadlessWrapper.lua) */
  srcDir: string;
  luajit: string;
  /** LUA_CPATH entry for lua-utf8 on non-Windows systems */
  cpath?: string;
}

export function pobInstallFromHome(pobHome: string): PobInstall {
  const home = resolve(pobHome);
  const srcDir = join(home, "PathOfBuilding-PoE2", "src");
  const override = process.env.ASTROLABE_LUAJIT;
  if (process.platform === "win32") {
    // PoB ships no luajit.exe; our Windows setup (tools/build_windows_luajit.sh,
    // windows-pob.yml) builds one and puts it next to PoB's lua51.dll, the same
    // place pob_bridge expects it. ASTROLABE_LUAJIT overrides the path.
    return {
      srcDir,
      luajit: override ?? join(home, "PathOfBuilding-PoE2", "runtime", "luajit.exe"),
    };
  }
  return { srcDir, luajit: override ?? join(home, "luajit"), cpath: join(home, "lib", "?.so") };
}

export const extractMetaSchema = z
  .object({
    pobVersion: z.string().min(1),
    latestTreeVersion: z.string().min(1),
    treeVersion: z.string().min(1).optional(),
    kinds: z.record(z.string(), z.number().int().positive()),
  })
  .strict();
export type ExtractMeta = z.infer<typeof extractMetaSchema>;

async function assertExists(path: string, what: string): Promise<void> {
  try {
    await access(path);
  } catch (cause) {
    throw new Error(`${what} not found at ${path} (run tools/setup_pob.sh)`, { cause });
  }
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (cause) => reject(new Error(`cannot start ${cmd}`, { cause })));
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

/**
 * Runs lua/extract.lua inside the pinned PoB and writes one raw JSON shard per
 * kind plus meta.json into outDir (which is replaced). Fails with PoB's output
 * if the extractor does not finish cleanly.
 */
export async function extractRaw(
  pob: PobInstall,
  sources: PobSources,
  outDir: string,
): Promise<ExtractMeta> {
  await assertExists(join(pob.srcDir, "HeadlessWrapper.lua"), "PoB HeadlessWrapper.lua");
  await assertExists(pob.luajit, "LuaJIT");

  const out = resolve(outDir);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const job = await buildExtractJob(sources, pob.srcDir, out.replaceAll("\\", "/"));
  // the job holds absolute paths, so it stays out of the (hashed) output
  const jobDir = await mkdtemp(join(tmpdir(), "astrolabe-extract-"));
  const jobPath = join(jobDir, "job.json");
  let res: Awaited<ReturnType<typeof run>>;
  try {
    await writeFile(jobPath, JSON.stringify(job, null, 2));
    const env = { ...process.env };
    if (pob.cpath) env.LUA_CPATH = `${pob.cpath};${env.LUA_CPATH ?? ";;"}`;
    res = await run(pob.luajit, [EXTRACT_LUA, jobPath], pob.srcDir, env);
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
  if (res.code !== 0 || !res.stdout.includes(OK_MARKER)) {
    const tail = (res.stderr + "\n" + res.stdout).trim().split("\n").slice(-15).join("\n");
    throw new Error(`PoB extraction failed (exit ${String(res.code)}):\n${tail}`);
  }

  const metaPath = join(out, "meta.json");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(metaPath, "utf8"));
  } catch (cause) {
    throw new Error(`extractor wrote no readable ${metaPath}`, { cause });
  }
  const meta = extractMetaSchema.parse(raw);
  for (const k of job.kinds) {
    if (meta.kinds[k.kind] === undefined) {
      throw new Error(`extractor did not report kind ${k.kind}`);
    }
  }
  return meta;
}
