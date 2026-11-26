import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "../App";
import { guideIdOf, parseRoute } from "../shell/route";
import { publishedGuide } from "../fixtures/guide-fixture";

const GUIDE_ID = publishedGuide.metadata.guideId;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

const view = {
  guide: publishedGuide,
  catalogReleaseId: publishedGuide.metadata.dataReleaseId,
  current: true,
  gear: [
    {
      budgetTier: "tier-a",
      slot: "FixtureSlot",
      target: {
        kind: "unique",
        name: "Fixture Unique Name",
        baseName: "Fixture Base",
        itemClass: "fixture_class",
        implicits: [{ modId: "Fixture/Implicit", text: "Implicit text" }],
        explicits: [{ text: "Unique line" }, { modId: "Fixture/NoText" }],
      },
      alternatives: [null],
    },
  ],
  names: {
    "gem:Fixture/Gems/Main": "Main Skill",
    "ascendancy:fixture_asc": "Fixture Ascendancy",
    "gem:Fixture/Gems/Support": "Support Skill",
  },
  results: {
    "calc-1": {
      calcId: "calc-1",
      pobVersion: "v9.9.9",
      dataReleaseId: publishedGuide.metadata.dataReleaseId,
      calcProfile: "default",
      inputHash: "a".repeat(64),
      computedAt: "2026-01-01T00:00:00Z",
      stats: { FixtureStatA: 1234.5 },
      warnings: [],
      unsupportedMods: [],
    },
  },
  unresolved: ["passiveNode:fixture_node_1"],
};

describe("route", () => {
  it("knows the guide list and one guide", () => {
    expect(parseRoute("#/guide")).toBe("guide");
    expect(parseRoute(`#/guide/${GUIDE_ID}`)).toBe("guide");
    expect(guideIdOf("#/guide")).toBeUndefined();
    expect(guideIdOf("#/guide/")).toBeUndefined();
    expect(guideIdOf("#/guide/a%20b")).toBe("a b");
  });
});

describe("guide list", () => {
  it("lists guides with names and says which one cannot be read", async () => {
    vi.stubGlobal("fetch", () =>
      json({
        guides: [
          {
            guideId: GUIDE_ID,
            dataReleaseId: publishedGuide.metadata.dataReleaseId,
            generatedAt: "2026-01-01T00:00:00Z",
            ascendancyId: "fixture_asc",
            ascendancyName: "Fixture Ascendancy",
            mainSkillId: "Fixture/Gems/Main",
            current: false,
          },
          { guideId: "broken-guide-id", error: "The stored guide cannot be read." },
        ],
      }),
    );
    window.location.hash = "#/guide";
    render(<App />);
    expect(await screen.findByText("Fixture Ascendancy")).toBeTruthy();
    // no name for the skill: the id stays visible instead of a made-up name
    expect(screen.getByText(/Fixture\/Gems\/Main/)).toBeTruthy();
    expect(screen.getByText("Older game data")).toBeTruthy();
    expect(screen.getByText("The stored guide cannot be read.")).toBeTruthy();
  });

  it("shows the server's error", async () => {
    vi.stubGlobal("fetch", () =>
      json(
        { error: { code: "invalid_request", message: "Listing guides needs the run store." } },
        400,
      ),
    );
    window.location.hash = "#/guide";
    render(<App />);
    expect(await screen.findByText("Listing guides needs the run store.")).toBeTruthy();
  });
});

describe("guide page", () => {
  it("shows names, numbers from the stored calculation and what is missing", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() => json(view));
    vi.stubGlobal("fetch", fetchMock);
    window.location.hash = `#/guide/${GUIDE_ID}`;
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Fixture Ascendancy: Main Skill",
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/guides/${GUIDE_ID}/view`);
    // the fixture's calc segment resolves to the stored value
    expect(screen.getAllByText("1,234.5").length).toBeGreaterThan(0);
    expect(screen.getByText(/passiveNode:fixture_node_1/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save as .build file" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Level 1–10/ })).toBeTruthy();
  });

  it("shows an unavailable calculation as its stat name, never as a number", async () => {
    vi.stubGlobal("fetch", () => json({ ...view, results: {}, unresolved: ["calc:calc-1"] }));
    window.location.hash = `#/guide/${GUIDE_ID}`;
    render(<App />);
    expect((await screen.findAllByText("FixtureStatA")).length).toBeGreaterThan(0);
    expect(screen.queryByText("1,234.5")).toBeNull();
  });

  it("shows the gear plan's items with catalog texts and says what is unknown", async () => {
    vi.stubGlobal("fetch", () => json(view));
    window.location.hash = `#/guide/${GUIDE_ID}`;
    render(<App />);
    expect(await screen.findByText("Fixture Unique Name")).toBeTruthy();
    expect(screen.getByText("Implicit text")).toBeTruthy();
    expect(screen.getByText("Unique line")).toBeTruthy();
    expect(screen.getByText(/Unknown modifier \(Fixture\/NoText\)/)).toBeTruthy();
  });

  it("says when the tree data cannot be loaded", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      url.endsWith("/api/tree")
        ? json({ error: { code: "internal", message: "Tree is down." } }, 500)
        : json(view),
    );
    window.location.hash = `#/guide/${GUIDE_ID}`;
    render(<App />);
    expect(await screen.findByText(/Tree is down\./)).toBeTruthy();
  });

  it("shows no gear for a guide of older game data and points to revalidation", async () => {
    vi.stubGlobal("fetch", () =>
      json({
        ...view,
        current: false,
        catalogReleaseId: "poe2-9.9.9+r9",
        names: {},
        gear: [{ ...view.gear[0], target: null, alternatives: [null] }],
      }),
    );
    window.location.hash = `#/guide/${GUIDE_ID}`;
    render(<App />);
    expect(await screen.findByText(/Revalidate this guide to see its gear/)).toBeTruthy();
    expect(screen.getByText(/Revalidate this guide to see its passive tree/)).toBeTruthy();
    expect(screen.queryByText(/not in the game data/)).toBeNull();
  });

  it("says so when the release does not know the rarity of a crafted item", async () => {
    const crafted = {
      kind: "crafted",
      rarityId: "odd_rarity",
      baseName: "Crafted Base",
      itemClass: "fixture_class",
      implicits: [],
      explicits: [],
    };
    vi.stubGlobal("fetch", () =>
      json({ ...view, gear: [{ ...view.gear[0], target: crafted, alternatives: [] }] }),
    );
    window.location.hash = `#/guide/${GUIDE_ID}`;
    render(<App />);
    expect(await screen.findByText(/does not know the rarity \(odd_rarity\)/)).toBeTruthy();
  });

  it("says when the guide was built with older game data", async () => {
    vi.stubGlobal("fetch", () =>
      json({ ...view, current: false, catalogReleaseId: "poe2-9.9.9+r9", names: {}, gear: [] }),
    );
    window.location.hash = `#/guide/${GUIDE_ID}`;
    render(<App />);
    expect(await screen.findByText(/Older game data/)).toBeTruthy();
    expect(screen.getByText(/poe2-9\.9\.9\+r9/)).toBeTruthy();
  });

  it("shows the server's reason when the guide cannot be loaded", async () => {
    vi.stubGlobal("fetch", () =>
      json({ error: { code: "unknown_run", message: "No stored guide." } }, 404),
    );
    window.location.hash = `#/guide/${GUIDE_ID}`;
    render(<App />);
    expect(await screen.findByText(/No stored guide\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    expect(window.location.hash).toBe("#/guide");
  });
});
