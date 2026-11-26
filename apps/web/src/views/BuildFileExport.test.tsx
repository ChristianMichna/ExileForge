import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BuildFileExportButton } from "./BuildFileExport";

const GUIDE_ID = "00000000-0000-4000-8000-000000000001";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function textOf(blob: Blob | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    if (blob === undefined) return reject(new Error("nothing was saved"));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("could not read the saved file"));
    reader.readAsText(blob);
  });
}

function answer(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function stubDownload() {
  const created: Blob[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: (blob: Blob) => {
      created.push(blob);
      return "blob:fixture";
    },
    revokeObjectURL: () => undefined,
  });
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return { created, names };
}

describe("BuildFileExportButton", () => {
  it("asks the server, saves the file and lists what is missing", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() =>
      answer(200, {
        file: { name: "Oracle: Fixture/Skill", passives: [] },
        omitted: ["passive 42: the release has no game id"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { created, names } = stubDownload();
    render(<BuildFileExportButton guideId={GUIDE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Save as .build file" }));
    expect(await screen.findByText("passive 42: the release has no game id")).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/guides/${GUIDE_ID}/build-file`,
    ]);
    expect(names).toEqual(["Oracle FixtureSkill.build"]);
    expect(JSON.parse(await textOf(created[0]))).toEqual({
      name: "Oracle: Fixture/Skill",
      passives: [],
    });
  });

  it("shows the server's reason and saves nothing when the export fails", async () => {
    vi.stubGlobal("fetch", () =>
      answer(400, { error: { code: "invalid_request", message: "Revalidate the guide first." } }),
    );
    const { created } = stubDownload();
    render(<BuildFileExportButton guideId={GUIDE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Save as .build file" }));
    expect(await screen.findByText("Revalidate the guide first.")).toBeTruthy();
    expect(created).toEqual([]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save as .build file" })).toBeTruthy(),
    );
  });

  it("rejects an answer it does not understand", async () => {
    vi.stubGlobal("fetch", () => answer(200, { nope: true }));
    stubDownload();
    render(<BuildFileExportButton guideId={GUIDE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Save as .build file" }));
    expect(await screen.findByText(/does not understand/)).toBeTruthy();
  });
});
