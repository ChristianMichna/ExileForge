import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { BuildRequest } from "@astrolabe/contracts/build";
import type { RunEvent } from "@astrolabe/contracts/events";
import { UserIntervention } from "@astrolabe/contracts/forge";
import { PublishedGuide } from "@astrolabe/contracts/guide";
import { guideToBuildFile } from "@astrolabe/exporters";
import { buildFileResolvers } from "../export/build-file-resolvers.js";
import type { GuideSweeper } from "../tools/guide-sweep.js";
import { ForgeError } from "../engine/errors.js";
import type { ForgeEngine } from "../engine/forge-engine.js";
import type { Logger } from "../logger.js";
import { createForgeMcpServer, type ForgeMcpDeps } from "../mcp/forge-mcp.js";

/** The only interface the server ever binds to (ADR-0004). */
export const LOOPBACK_HOST = "127.0.0.1";

/** Max body size; submissions are small structured payloads. */
const BODY_LIMIT_BYTES = 1_000_000;
const SSE_KEEPALIVE_MS = 15_000;
/** Open live-event streams over all runs; the app window needs one or two. */
const MAX_SSE_STREAMS = 16;
/** Validation messages returned to callers are cut to this length. */
const MAX_ERROR_MESSAGE_CHARS = 2000;
/** Routes that answer without the access token (no run data). */
const PUBLIC_ROUTES = new Set(["/api/health"]);

export interface AppOptions extends ForgeMcpDeps {
  engine: ForgeEngine;
  logger: Logger;
  /** Port the server listens on; Host headers must name it (DNS rebinding guard). */
  port: number;
  /** Browser origins allowed to call the API (the app's own window). Requests without Origin pass. */
  allowedOrigins: readonly string[];
  /** Default pipeline for new runs. */
  defaultPipelineId: string;
  /** Set in catalog-only mode (no matching engine); shown by /api/health and the app window. */
  catalogOnlyReason?: string;
  /** Automatic revalidation of stored guides (F-19); absent without a releases directory. */
  guideSweep?: GuideSweeper;
  /** The stored guide with this id (see `RunStore.findGuide`), unvalidated; enables the guide and `.build` routes. */
  findGuide?: (guideId: string) => unknown;
  /** Ids of all stored guides, newest first (see `RunStore.listGuideIds`). */
  listGuideIds?: () => string[];
  /**
   * Per-installation secret. Every request except /api/health must send
   * `Authorization: Bearer <token>`, so other local processes and web pages
   * cannot drive the server. The app window and the .mcpb bridge read it
   * from the token file; Claude Code gets it via `claude mcp add --header`.
   */
  accessToken: string;
}

const CreateRunBody = z.object({
  request: BuildRequest,
  pipelineId: z.string().min(1).optional(),
});
const RunParams = z.object({ runId: z.string().min(1) });
const GuideParams = z.object({ guideId: z.string().min(1).max(200) });
/** Name inside the exported `.build` file. */
const BUILD_FILE_NAME_MAX_CHARS = 80;

/** Local API + MCP endpoint. Never listens on anything but 127.0.0.1. */
export function createApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT_BYTES });
  const { engine, logger } = options;
  const expectedToken = digest(options.accessToken);
  const tokenMatches = (header: string | undefined) =>
    header?.startsWith("Bearer ") === true &&
    timingSafeEqual(digest(header.slice("Bearer ".length)), expectedToken);
  let openStreams = 0;
  const allowedHosts = new Set([`${LOOPBACK_HOST}:${options.port}`, `localhost:${options.port}`]);

  // DNS-rebinding and cross-site guard: a web page may not drive the local server.
  app.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host;
    if (host === undefined || !allowedHosts.has(host)) {
      return reply.code(403).send({ error: { code: "forbidden_host", message: "Forbidden host" } });
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !options.allowedOrigins.includes(origin)) {
      return reply
        .code(403)
        .send({ error: { code: "forbidden_origin", message: "Forbidden origin" } });
    }
    if (!PUBLIC_ROUTES.has(request.url) && !tokenMatches(request.headers.authorization)) {
      return reply.code(401).send({
        error: {
          code: "unauthorized",
          message:
            "Missing or wrong Astrolabe access token. Reconnect Claude from the Astrolabe app.",
        },
      });
    }
    return undefined;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ForgeError) {
      const status =
        error.code === "unknown_run" ? 404 : error.code === "invalid_request" ? 400 : 409;
      return reply.code(status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: {
          code: "invalid_request",
          message: z.prettifyError(error).slice(0, MAX_ERROR_MESSAGE_CHARS),
        },
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: "bad_request", message: "Bad request" } });
    }
    logger.error("request failed", { error });
    return reply.code(500).send({ error: { code: "internal", message: "Internal error" } });
  });

  app.get("/api/health", async () => ({
    ok: true,
    calcEngine: engine.calcEngine,
    dataReleaseId: options.catalog.dataReleaseId,
    ...(options.catalogOnlyReason === undefined
      ? {}
      : { catalogOnly: true, catalogOnlyReason: options.catalogOnlyReason }),
  }));

  app.get("/api/guides/patch-status", async () => {
    if (options.guideSweep === undefined) {
      return {
        enabled: false,
        releaseId: options.catalog.dataReleaseId,
        running: false,
        guides: [],
      };
    }
    return options.guideSweep.view();
  });

  app.post("/api/guides/patch-status/refresh", async (_request, reply) => {
    const sweep = options.guideSweep;
    if (sweep === undefined) {
      throw new ForgeError("invalid_request", "Checking stored guides needs a releases directory.");
    }
    void sweep.run({ force: true }).catch((error: unknown) => {
      logger.error("guide sweep crashed", { error });
    });
    return reply.code(202).send(sweep.view());
  });

  app.get("/api/guides", async () => {
    if (options.listGuideIds === undefined || options.findGuide === undefined) {
      throw new ForgeError("invalid_request", "Listing guides needs the run store.");
    }
    const find = options.findGuide;
    const guides = options.listGuideIds().map((guideId) => {
      const guide = PublishedGuide.safeParse(find(guideId));
      if (!guide.success) {
        logger.error("stored guide is not valid", { guideId, error: guide.error });
        return { guideId, error: "The stored guide is not valid." };
      }
      const { summary, metadata } = guide.data;
      return {
        guideId,
        dataReleaseId: metadata.dataReleaseId,
        generatedAt: metadata.generatedAt,
        ascendancyId: summary.ascendancyId,
        ascendancyName: options.catalog.get({ kind: "ascendancy", id: summary.ascendancyId })?.name,
        mainSkillId: summary.mainSkillId,
        mainSkillName: options.catalog.get({ kind: "gem", id: summary.mainSkillId })?.name,
        current: metadata.dataReleaseId === options.catalog.dataReleaseId,
      };
    });
    return { guides };
  });

  app.get("/api/guides/:guideId", async (request) => {
    const { guideId } = GuideParams.parse(request.params);
    if (options.findGuide === undefined) {
      throw new ForgeError("invalid_request", "Reading guides needs the run store.");
    }
    const stored = options.findGuide(guideId);
    if (stored === undefined) throw new ForgeError("unknown_run", `No stored guide ${guideId}.`);
    const guide = PublishedGuide.safeParse(stored);
    if (!guide.success) {
      throw new ForgeError("invalid_request", `Stored guide ${guideId} is not a valid guide.`, {
        cause: guide.error,
      });
    }
    return guide.data;
  });

  app.get("/api/guides/:guideId/build-file", async (request) => {
    const { guideId } = GuideParams.parse(request.params);
    if (options.findGuide === undefined) {
      throw new ForgeError("invalid_request", "The .build export needs the run store.");
    }
    const stored = options.findGuide(guideId);
    if (stored === undefined) throw new ForgeError("unknown_run", `No stored guide ${guideId}.`);
    const guide = PublishedGuide.safeParse(stored);
    if (!guide.success) {
      throw new ForgeError("invalid_request", `Stored guide ${guideId} is not a valid guide.`, {
        cause: guide.error,
      });
    }
    const { dataReleaseId } = guide.data.metadata;
    if (dataReleaseId !== options.catalog.dataReleaseId) {
      throw new ForgeError(
        "invalid_request",
        `The guide was built with ${dataReleaseId}, the loaded release is ${options.catalog.dataReleaseId}; revalidate it first.`,
      );
    }
    const { ascendancyId, mainSkillId } = guide.data.summary;
    const parts = [
      options.catalog.get({ kind: "ascendancy", id: ascendancyId })?.name,
      options.catalog.get({ kind: "gem", id: mainSkillId })?.name,
    ].filter((part): part is string => part !== undefined);
    const name = (parts.length > 0 ? parts.join(" ") : guideId).slice(0, BUILD_FILE_NAME_MAX_CHARS);
    try {
      return guideToBuildFile(guide.data, buildFileResolvers(options.catalog), name);
    } catch (cause) {
      throw new ForgeError(
        "invalid_request",
        `Guide ${guideId} cannot be exported: ${cause instanceof Error ? cause.message : "unknown error"}`,
        { cause },
      );
    }
  });

  app.post("/api/runs", async (request, reply) => {
    const body = CreateRunBody.parse(request.body);
    const created = await engine.createRun(
      body.request,
      body.pipelineId ?? options.defaultPipelineId,
    );
    return reply.code(201).send(created);
  });

  app.get("/api/runs/:runId", async (request) => {
    const { runId } = RunParams.parse(request.params);
    return engine.view(runId);
  });

  app.post("/api/runs/:runId/session-code", async (request) => {
    const { runId } = RunParams.parse(request.params);
    return engine.issueSessionCode(runId);
  });

  app.post("/api/runs/:runId/interventions", async (request) => {
    const { runId } = RunParams.parse(request.params);
    return engine.intervene(runId, UserIntervention.parse(request.body));
  });

  app.get("/api/runs/:runId/events", async (request, reply) => {
    const { runId } = RunParams.parse(request.params);
    await engine.view(runId); // 404 before the stream starts
    const lastId = request.headers["last-event-id"] ?? (request.query as { after?: string }).after;
    const after = lastId === undefined ? -1 : Number(lastId);
    if (!Number.isInteger(after) || after < -1) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_request", message: "Bad Last-Event-ID" } });
    }
    if (openStreams >= MAX_SSE_STREAMS) {
      return reply
        .code(429)
        .send({ error: { code: "too_many_streams", message: "Too many event streams" } });
    }
    openStreams += 1;
    streamEvents(reply, engine, runId, after, () => (openStreams -= 1));
    return reply;
  });

  app.post("/mcp", async (request, reply) => {
    const server = createForgeMcpServer(options);
    // No sessionIdGenerator: stateless mode; all run state lives in the engine.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport
        .close()
        .catch((error: unknown) => logger.error("mcp transport close failed", { error }));
      void server
        .close()
        .catch((error: unknown) => logger.error("mcp server close failed", { error }));
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      logger.error("mcp request failed", { error });
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal error" },
            id: null,
          }),
        );
      }
    }
  });
  const methodNotAllowed = async (_request: unknown, reply: FastifyReply) =>
    reply
      .code(405)
      .header("allow", "POST")
      .send({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed (stateless server)" },
        id: null,
      });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}

/** Server-Sent Events: replay from the store after `after`, then live; ids are run seqs. */
function streamEvents(
  reply: FastifyReply,
  engine: ForgeEngine,
  runId: string,
  after: number,
  onClose: () => void,
): void {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  let lastSeq = after;
  const send = (event: RunEvent) => {
    if (event.seq <= lastSeq || res.destroyed) return;
    lastSeq = event.seq;
    res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  // Subscribe first, then replay: events emitted in between are deduplicated by seq.
  const buffered: RunEvent[] = [];
  let replaying = true;
  const unsubscribe = engine.subscribe(runId, (event) =>
    replaying ? buffered.push(event) : send(event),
  );
  for (const event of engine.eventsAfter(runId, after)) send(event);
  replaying = false;
  for (const event of buffered) send(event);
  const keepAlive = setInterval(() => {
    if (!res.destroyed) res.write(": keep-alive\n\n");
  }, SSE_KEEPALIVE_MS);
  // "close" also follows a socket error; the error itself needs a listener so it is not thrown.
  res.on("error", () => res.destroy());
  res.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
    onClose();
  });
}

/** Fixed-length digest so timingSafeEqual never sees different lengths. */
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
