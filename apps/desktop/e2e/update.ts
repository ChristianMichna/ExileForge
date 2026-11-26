/**
 * Windows check of the self-update (F-09): installs an OLD release, lets the installed app find
 * the new version, download it, install it and start as the new version.
 *
 *   node --experimental-strip-types e2e/update.ts <old installer> <out dir> <expected version> \
 *     [--local <folder with the new installer + latest.yml>]
 *
 * Without --local the app uses its real update source (GitHub releases): run it after the new
 * release is published. With --local the installed app's `app-update.yml` is pointed at a local
 * web server that serves the new build, so a pull request can check the mechanism before the
 * release exists (download, checksum, install, restart).
 */
import { spawn, spawnSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

const DEBUG_PORT = 9334;
const FEED_PORT = 47616;

const [oldInstaller, outArg, expected] = process.argv.slice(2);
if (oldInstaller === undefined || outArg === undefined || expected === undefined) {
  throw new Error("usage: update.ts <old installer> <out dir> <expected version> [--local <dir>]");
}
const localIndex = process.argv.indexOf("--local");
const localDir = localIndex < 0 ? undefined : process.argv[localIndex + 1];
const oldPath: string = oldInstaller;
const expectedVersion: string = expected;
if (localIndex >= 0 && localDir === undefined) throw new Error("--local needs a folder");
if (process.platform !== "win32") throw new Error("this check runs the Windows installer");
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`environment variable ${name} is not set`);
  return value;
};

async function until<T>(
  what: string,
  timeoutMs: number,
  probe: () => Promise<T | undefined>,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last = "no answer yet";
  while (Date.now() < end) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(1000);
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what} (last: ${last})`);
}

const results: { step: string; ok: boolean; seconds: number; error?: string }[] = [];
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  console.log(`::group::${name}`);
  try {
    const value = await fn();
    results.push({ step: name, ok: true, seconds: (Date.now() - started) / 1000 });
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ step: name, ok: false, seconds: (Date.now() - started) / 1000, error: message });
    console.error(`FAILED: ${message}`);
    throw error;
  } finally {
    console.log("::endgroup::");
  }
}

interface Status {
  appVersion: string;
  update: { state: string; version?: string; message?: string; reason?: string; percent?: number };
}

let browser: Browser | undefined;
let page: Page | undefined;
let feed: Server | undefined;

function stopApp(): void {
  // also the instance the installer starts after an update, which has no child link to us
  spawnSync("taskkill", ["/IM", "Astrolabe.exe", "/T", "/F"], { stdio: "ignore" });
}

function installSilently(installer: string): string {
  const run = spawnSync(resolve(installer), ["/S"], { stdio: "inherit", timeout: 300_000 });
  if (run.status !== 0) throw new Error(`installer exited with ${run.status ?? run.error}`);
  const programs = join(env("LOCALAPPDATA"), "Programs");
  const dir = existsSync(programs)
    ? readdirSync(programs)
        .map((name) => join(programs, name))
        .find((candidate) => existsSync(join(candidate, "Astrolabe.exe")))
    : undefined;
  if (dir === undefined) throw new Error(`no Astrolabe.exe below ${programs}`);
  return dir;
}

async function launch(installDir: string): Promise<Page> {
  spawn(join(installDir, "Astrolabe.exe"), [`--remote-debugging-port=${DEBUG_PORT}`], {
    stdio: "ignore",
  });
  browser = await until("the DevTools port", 120_000, async () =>
    chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`),
  );
  page = await until("the app window", 60_000, async () =>
    browser
      ?.contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().startsWith("astrolabe://")),
  );
  return page;
}

function needPage(): Page {
  if (page === undefined) throw new Error("the app window is not connected yet");
  return page;
}

const status = (p: Page) => p.evaluate("window.astrolabe.getStatus()") as Promise<Status>;

async function main(): Promise<void> {
  if (localDir !== undefined) {
    await step("Serve the new build locally", async () => {
      const root = resolve(localDir);
      const created = createServer((request, response) => {
        const name = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/").replace(
          /^\/+/,
          "",
        );
        // The blockmap is not served: the updater then downloads the whole file (no Range requests).
        const file = join(root, name);
        if (name === "" || name.includes("..") || name.endsWith(".blockmap") || !existsSync(file)) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { "content-type": "application/octet-stream" });
        createReadStream(file).pipe(response);
      });
      feed = created;
      const server = created;
      await new Promise<void>((done) => server.listen(FEED_PORT, "127.0.0.1", done));
      if (!existsSync(join(root, "latest.yml"))) throw new Error(`no latest.yml in ${root}`);
    });
  }

  const installDir = await step("Install the old release", async () => installSilently(oldPath));
  const updateYml = join(installDir, "resources", "app-update.yml");

  await step("Update source of the installed app", async () => {
    if (localDir !== undefined) {
      writeFileSync(updateYml, `provider: generic\nurl: http://127.0.0.1:${FEED_PORT}/\n`);
    } else if (!/provider: github/.test(readFileSync(updateYml, "utf8"))) {
      throw new Error(
        `the installed app does not update from GitHub: ${readFileSync(updateYml, "utf8")}`,
      );
    }
  });

  const oldVersion = await step("Old app starts", async () => {
    const p = await launch(installDir);
    const s = await until("the app status", 120_000, async () => {
      const current = await status(p);
      return current.appVersion ? current : undefined;
    });
    if (s.appVersion === expectedVersion)
      throw new Error(`the old release already is ${expectedVersion}`);
    await p.screenshot({ path: join(outDir, "01-old.png") });
    return s.appVersion;
  });
  console.log(`old version ${oldVersion}, waiting for ${expectedVersion}`);

  await step("App finds, downloads and verifies the new version", async () => {
    const p = needPage();
    const s = await until(`update ${expectedVersion} ready`, 600_000, async () => {
      const current = await status(p);
      if (current.update.state === "failed")
        throw new Error(`update failed: ${current.update.message}`);
      if (current.update.state === "disabled")
        throw new Error(`updates are off: ${current.update.reason}`);
      return current.update.state === "ready" ? current : undefined;
    });
    if (s.update.version !== expectedVersion) {
      throw new Error(`the app offers ${s.update.version}, expectedVersion ${expectedVersion}`);
    }
    await p.screenshot({ path: join(outDir, "02-update-ready.png") });
  });

  await step("Restart to update installs the new version", async () => {
    const answer = (await needPage().evaluate("window.astrolabe.installUpdate()")) as {
      ok: boolean;
      message: string;
    };
    if (!answer.ok) throw new Error(answer.message);
    await browser?.close().catch(() => undefined);
    // the installer replaces the files; the exe must say the new version afterwards
    await until("the installed exe to be the new version", 300_000, async () => {
      const out = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-Item '${join(installDir, "Astrolabe.exe")}').VersionInfo.ProductVersion`,
        ],
        { encoding: "utf8" },
      );
      return out.stdout.trim().startsWith(expectedVersion) ? true : undefined;
    });
    await sleep(15_000); // the installer starts the app by itself; stop it for a controlled start
    stopApp();
  });

  await step("New app starts with the new version", async () => {
    const p = await launch(installDir);
    const s = await until("the new app status", 120_000, async () => {
      const current = await status(p);
      return current.appVersion ? current : undefined;
    });
    if (s.appVersion !== expectedVersion)
      throw new Error(`app says ${s.appVersion}, expectedVersion ${expectedVersion}`);
    await p.screenshot({ path: join(outDir, "03-new.png") });
  });
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  console.error(error);
  await page?.screenshot({ path: join(outDir, "failure.png") }).catch(() => undefined);
} finally {
  await browser?.close().catch(() => undefined);
  stopApp();
  feed?.close();
  writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 2));
  console.log(
    results
      .map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.step} (${r.seconds.toFixed(1)}s)`)
      .join("\n"),
  );
}
process.exit(failed ? 1 : 0);
