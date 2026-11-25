import { isAllowedExternalUrl } from "./security.js";

/** Fills the `{code}` placeholder of the configured start sentence. */
export function buildStartSentence(template: string, code: string): string {
  return template.replace("{code}", () => code);
}

/**
 * The command that registers the local MCP endpoint in Claude Code. It carries
 * the access token, so it goes to the clipboard from the main process and is
 * never returned to page code.
 */
export function buildClaudeCodeCommand(serverUrl: string, token: string): string {
  return `claude mcp add --transport http exileforge ${serverUrl}/mcp --header "Authorization: Bearer ${token}"`;
}

export interface OpenClaudeOutcome {
  readonly opened: boolean;
  readonly reason?: string;
}

/** Tries to bring Claude Desktop to the front; failure is reported, never swallowed. */
export async function openClaudeDesktop(
  openExternal: (url: string) => Promise<void>,
  url: string,
  allowedSchemes: readonly string[],
): Promise<OpenClaudeOutcome> {
  if (!isAllowedExternalUrl(url, allowedSchemes)) {
    return { opened: false, reason: "The configured Claude Desktop link is not allowed." };
  }
  try {
    await openExternal(url);
    return { opened: true };
  } catch (error) {
    return {
      opened: false,
      reason: `Claude Desktop could not be opened (${error instanceof Error ? error.message : "unknown error"}). Open it yourself and paste the sentence.`,
    };
  }
}
