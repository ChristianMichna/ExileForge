import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { BuildRequest } from "@exileforge/contracts/build";
import type { RunEvent } from "@exileforge/contracts/events";
import { UserIntervention } from "@exileforge/contracts/forge";
import { ForgeError } from "../engine/errors.js";
import type { ForgeEngine } from "../engine/forge-engine.js";
import type { Logger } from "../logger.js";
import { createForgeMcpServer, type ForgeMcpDeps } from "../mcp/forge-mcp.js";

/** The only interface the server ever binds to (ADR-0004). */
export const LOOPBACK_HOST = "127.0.0.1";

/** Max body size; submissions are small structured payloads. */
const BODY_LIMIT_BYTES = 1_000_000;
const SSE_KEEPALIVE_MS = 15_000;

export interface AppOptions extends ForgeMcpDeps {
  engine: ForgeEngine;
  logger: Logger;
  /** Port the server listens on; Host headers must name it (DNS rebinding guard). */
  port: number;
  /** Browser origins allowed to call the API (the app's own window). Requests without Origin pass. */
  allowedOrigins: readonly string[];
  /** Default pipeline for new runs. */
  defaultPipelineId: string;
}

const CreateRunBody = z.object({
  request: BuildRequest,
  pipelineId: z.string().min(1).optional(),
});
const RunParams = z.object({ runId: z.string().min(1) });

/** Local API + MCP endpoint. Never listens on anything but 127.0.0.1. */
export function createApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT_BYTES });
  const { engine, logger } = options;
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
    return undefined;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ForgeError) {
      const status = error.code === "unknown_run" ? 404 : 409;
      return reply.code(status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_request", message: z.prettifyError(error) } });
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
  }));

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
    streamEvents(reply, engine, runId, after);
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
    if (event.seq <= lastSeq) return;
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
  const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), SSE_KEEPALIVE_MS);
  res.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
}
