/**
 * Starts an installed .mcpb extension the way Claude Desktop does: reads manifest.json, fills in
 * `${__dirname}` and `${user_config.*}` and runs `server.mcp_config` as a child process with
 * JSON-RPC lines on stdin/stdout. Used by the Windows end-to-end check (run.ts).
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export interface McpbManifest {
  readonly server: {
    readonly mcp_config: {
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
    };
  };
  readonly user_config?: Readonly<Record<string, { readonly default?: unknown }>>;
  readonly tools?: readonly { readonly name: string }[];
}

export interface LaunchSpec {
  readonly command: string;
  readonly args: string[];
  readonly env: Record<string, string>;
}

/** Substitutes the manifest variables; an unknown variable is an error, never an empty string. */
export function resolveLaunch(
  manifest: McpbManifest,
  extensionDir: string,
  nodePath: string,
): LaunchSpec {
  const config = manifest.server.mcp_config;
  const substitute = (text: string): string =>
    text.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
      if (name === "__dirname") return extensionDir;
      const key = /^user_config\.(.+)$/.exec(name)?.[1];
      const value = key === undefined ? undefined : manifest.user_config?.[key]?.default;
      if (value === undefined) throw new Error(`manifest variable \${${name}} has no value`);
      return String(value);
    });
  return {
    // Claude Desktop runs "node" with its own bundled runtime; the check uses the runner's.
    command: config.command === "node" ? nodePath : substitute(config.command),
    args: (config.args ?? []).map(substitute),
    env: Object.fromEntries(
      Object.entries(config.env ?? {}).map(([name, value]) => [name, substitute(value)]),
    ),
  };
}

export class McpError extends Error {
  override readonly name = "McpError";
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class McpStdioClient {
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly stderrLines: string[] = [];
  private exited: string | undefined;

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    createInterface({ input: child.stdout }).on("line", (line) => this.onLine(line));
    createInterface({ input: child.stderr }).on("line", (line) => this.stderrLines.push(line));
    child.on("exit", (code, signal) => {
      this.exited = `exited with ${code ?? signal}`;
      for (const p of this.pending.values()) p.reject(new McpError(this.describe(this.exited)));
      this.pending.clear();
    });
  }

  static start(spec: LaunchSpec): McpStdioClient {
    const child = spawn(spec.command, spec.args, {
      env: { ...process.env, ...spec.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new McpStdioClient(child);
  }

  /** What the extension wrote to stderr (Claude Desktop's MCP log). */
  get log(): string {
    return this.stderrLines.join("\n");
  }

  private describe(message: string): string {
    return `${message}\nextension stderr:\n${this.log || "(empty)"}`;
  }

  private onLine(line: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      message = JSON.parse(line) as typeof message;
    } catch (error) {
      throw new McpError(`extension wrote a non-JSON line to stdout: ${line.slice(0, 200)}`, {
        cause: error,
      });
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (pending === undefined) return;
    this.pending.delete(message.id);
    if (message.error !== undefined) {
      pending.reject(new McpError(message.error.message ?? JSON.stringify(message.error)));
    } else pending.resolve(message.result);
  }

  request(method: string, params: unknown, timeoutMs = 120_000): Promise<unknown> {
    if (this.exited !== undefined) {
      return Promise.reject(new McpError(this.describe(`extension ${this.exited}`)));
    }
    const id = this.nextId++;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(this.describe(`${method} timed out after ${timeoutMs} ms`)));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return result;
  }

  notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-desktop-e2e", version: "0.0.0" },
    });
    this.notify("notifications/initialized");
  }

  /**
   * Like Claude Desktop, which hands object and array arguments over as JSON strings (that is why
   * `forge_submit` once rejected its payload with "expected object, received string"). Pass
   * `stringify: false` for the plain form.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { stringify?: boolean } = {},
  ): Promise<{ isError: boolean; text: string; structured: unknown }> {
    const argumentsValue =
      options.stringify === false
        ? args
        : Object.fromEntries(
            Object.entries(args).map(([key, value]) => [
              key,
              typeof value === "object" && value !== null ? JSON.stringify(value) : value,
            ]),
          );
    const result = (await this.request("tools/call", { name, arguments: argumentsValue })) as {
      isError?: boolean;
      content?: { type: string; text?: string }[];
      structuredContent?: unknown;
    };
    const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
    return { isError: result.isError === true, text, structured: result.structuredContent };
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}
