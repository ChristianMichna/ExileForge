import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuideFileExportButton, GuideImportButton } from "./GuideFile";

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

const answer = (status: number, body: unknown): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function pickFile(text: string): void {
  const input = screen.getByLabelText("Guide file") as HTMLInputElement;
  const file = new File([text], "guide.json", { type: "application/json" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("GuideImportButton", () => {
  it("sends the picked file to the server and reports the stored guide", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      answer(201, { guideId: GUIDE_ID }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onImported = vi.fn();
    render(<GuideImportButton onImported={onImported} />);
    pickFile('{"format":"astrolabe-guide"}');
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(GUIDE_ID));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/guides/import");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"format":"astrolabe-guide"}');
  });

  it("shows the server's reason and imports nothing when the file is refused", async () => {
    vi.stubGlobal("fetch", () =>
      answer(400, { error: { code: "invalid_request", message: "This is not a valid file." } }),
    );
    const onImported = vi.fn();
    render(<GuideImportButton onImported={onImported} />);
    pickFile("{}");
    expect(await screen.findByText("This is not a valid file.")).toBeTruthy();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("says so without asking the server when the file is not JSON", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<GuideImportButton onImported={vi.fn()} />);
    pickFile("not json");
    expect(await screen.findByText(/not valid JSON/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GuideFileExportButton", () => {
  it("saves the file the server wrote, unchanged", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() =>
      Promise.resolve(new Response('{"format":"astrolabe-guide"}', { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const saved: Blob[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        saved.push(blob);
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
    render(<GuideFileExportButton guideId={GUIDE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Save as guide file" }));
    await waitFor(() => expect(names).toEqual(["Astrolabe guide 00000000.json"]));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/guides/${GUIDE_ID}/file`);
    expect(await textOf(saved[0])).toBe('{"format":"astrolabe-guide"}');
  });

  it("shows the server's reason and saves nothing when the export fails", async () => {
    vi.stubGlobal("fetch", () =>
      answer(400, { error: { code: "invalid_request", message: "No stored result." } }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    render(<GuideFileExportButton guideId={GUIDE_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Save as guide file" }));
    expect(await screen.findByText("No stored result.")).toBeTruthy();
    expect(click).not.toHaveBeenCalled();
  });
});
