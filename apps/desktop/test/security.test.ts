import { describe, expect, it } from "vitest";
import {
  CONTENT_SECURITY_POLICY,
  isAllowedExternalUrl,
  isCitationUrl,
  isAppUrl,
  isTrustedSender,
} from "../src/main/security.js";

describe("security helpers", () => {
  it("recognises only the app origin", () => {
    expect(isAppUrl("astrolabe://app/index.html")).toBe(true);
    expect(isAppUrl("astrolabe://other/index.html")).toBe(false);
    expect(isAppUrl("https://astrolabe.app/")).toBe(false);
    expect(isAppUrl("file:///C:/x.html")).toBe(false);
    expect(isAppUrl("not a url")).toBe(false);
  });

  it("trusts IPC only from app frames", () => {
    expect(isTrustedSender("astrolabe://app/index.html#/plan")).toBe(true);
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

import { isDataSyncUrl } from "../src/main/security.js";

describe("data sync requests", () => {
  const hosts = ["github.com", "release-assets.githubusercontent.com"];
  it("allows the GitHub API and the configured download hosts over https only", () => {
    expect(isDataSyncUrl("https://api.github.com/repos/o/r/releases", hosts)).toBe(true);
    expect(isDataSyncUrl("https://github.com/o/r/releases/download/t/f", hosts)).toBe(true);
    expect(isDataSyncUrl("http://github.com/o/r", hosts)).toBe(false);
    expect(isDataSyncUrl("https://evil.example/x", hosts)).toBe(false);
    expect(isDataSyncUrl("https://github.com:8443/x", hosts)).toBe(false);
    expect(isDataSyncUrl("https://u:p@github.com/x", hosts)).toBe(false);
    expect(isDataSyncUrl("not a url", hosts)).toBe(false);
  });
});

describe("citation links", () => {
  it("opens https links without credentials and nothing else", () => {
    expect(isCitationUrl("https://example.test/guide")).toBe(true);
    expect(isCitationUrl("http://example.test/guide")).toBe(false);
    expect(isCitationUrl("https://user:pw@example.test/")).toBe(false);
    expect(isCitationUrl("javascript:alert(1)")).toBe(false);
    expect(isCitationUrl("file:///etc/passwd")).toBe(false);
    expect(isCitationUrl("not a url")).toBe(false);
  });
});
