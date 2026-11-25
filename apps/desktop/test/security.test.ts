import { describe, expect, it } from "vitest";
import {
  CONTENT_SECURITY_POLICY,
  isAllowedExternalUrl,
  isAppUrl,
  isTrustedSender,
} from "../src/main/security.js";

describe("security helpers", () => {
  it("recognises only the app origin", () => {
    expect(isAppUrl("exileforge://app/index.html")).toBe(true);
    expect(isAppUrl("exileforge://other/index.html")).toBe(false);
    expect(isAppUrl("https://exileforge.app/")).toBe(false);
    expect(isAppUrl("file:///C:/x.html")).toBe(false);
    expect(isAppUrl("not a url")).toBe(false);
  });

  it("trusts IPC only from app frames", () => {
    expect(isTrustedSender("exileforge://app/index.html#/plan")).toBe(true);
    expect(isTrustedSender("https://evil.example/")).toBe(false);
    expect(isTrustedSender(undefined)).toBe(false);
  });

  it("limits external links to the configured schemes", () => {
    expect(isAllowedExternalUrl("claude://", ["claude:"])).toBe(true);
    expect(isAllowedExternalUrl("https://example.com", ["claude:"])).toBe(false);
    expect(isAllowedExternalUrl("file:///C:/Windows/calc.exe", ["claude:"])).toBe(false);
    expect(isAllowedExternalUrl("%%%", ["claude:"])).toBe(false);
  });

  it("CSP allows no remote hosts and no inline scripts", () => {
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:/);
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
  });
});
