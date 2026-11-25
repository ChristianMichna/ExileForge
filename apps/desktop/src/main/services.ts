import { z } from "zod";
import {
  createStderrLogger,
  defaultTokenFile,
  loadOrCreateAccessToken,
  startServer,
  type Logger,
} from "@exileforge/server";

const Health = z.object({
  calcEngine: z.enum(["fake", "pob"]),
  dataReleaseId: z.string().min(1),
});

export interface Services {
  readonly url: string;
  readonly token: string;
  readonly port: number;
  readonly calcEngine: "fake" | "pob";
  readonly dataReleaseId: string;
  stop(): Promise<void>;
}

export interface StartServicesOptions {
  port: number;
  databasePath: string;
  catalogDir: string;
  forgeConfigPath: string;
  stagesConfigPath: string;
  logger?: Logger;
}

/**
 * Starts the local server in-process on 127.0.0.1. The access token lives in
 * the same file the .mcpb bridge reads, so Claude Desktop finds it.
 *
 * The calc engine is still calc-fake: the PoB worker pool (apps/calc) is
 * connected to the server by the calc adapter. `calcEngine` in the result
 * tells the UI honestly which one is running.
 */
export async function startServices(options: StartServicesOptions): Promise<Services> {
  const logger = options.logger ?? createStderrLogger("server");
  const tokenFile = defaultTokenFile();
  let started: Awaited<ReturnType<typeof startServer>>;
  try {
    started = await startServer({
      port: options.port,
      databasePath: options.databasePath,
      catalogDir: options.catalogDir,
      configPath: options.forgeConfigPath,
      stagesConfigPath: options.stagesConfigPath,
      calc: "fake",
      allowedOrigins: [],
      tokenFile,
      logger,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new Error(
        `Port ${options.port} is already in use. Close the other program or ExileForge window that uses it.`,
        { cause: error },
      );
    }
    throw error;
  }
  const token = await loadOrCreateAccessToken(tokenFile);
  let health: z.infer<typeof Health>;
  try {
    const response = await fetch(`${started.url}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    health = Health.parse(await response.json());
  } catch (error) {
    await started.app.close();
    throw new Error("The local server started but did not answer its health check.", {
      cause: error,
    });
  }
  return {
    url: started.url,
    token,
    port: options.port,
    calcEngine: health.calcEngine,
    dataReleaseId: health.dataReleaseId,
    stop: () => started.app.close(),
  };
}
