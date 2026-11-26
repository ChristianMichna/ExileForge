import { useEffect, useRef, useState } from "react";
import { Button, Callout } from "@astrolabe/ui";
import { importGuideFile, loadGuideFileText } from "../api/guide-file";

/** Characters that are not safe in a file name. */
const UNSAFE_FILE_CHARS = /[^\p{L}\p{N} _-]+/gu;

function saveText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // The save starts synchronously on click; the URL is not needed afterwards.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsText(file);
  });
}

/** Reads a guide file the player picked and stores it; says why the server refuses a file. */
export function GuideImportButton({ onImported }: { onImported: (guideId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);

  const pick = (file: File | undefined) => {
    if (file === undefined) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setProblem(undefined);
    readText(file)
      .then((text) => importGuideFile(text, controller.signal))
      .then((guideId) => {
        if (controller.signal.aborted) return;
        setBusy(false);
        onImported(guideId);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setBusy(false);
        setProblem(error instanceof Error ? error.message : "The import failed.");
      });
  };

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Guide file"
        onChange={(event) => {
          pick(event.target.files?.[0]);
          // The same file can be picked again after a failure.
          event.target.value = "";
        }}
      />
      <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? "Importing…" : "Import a guide file"}
      </Button>
      {problem === undefined ? null : (
        <Callout tone="danger" title="The guide could not be imported" live>
          {problem}
        </Callout>
      )}
    </div>
  );
}

/** Saves a guide with its measurements as a file that can be imported on another computer. */
export function GuideFileExportButton({ guideId }: { guideId: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);

  const run = () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setProblem(undefined);
    loadGuideFileText(guideId, controller.signal)
      .then((text) => {
        if (controller.signal.aborted) return;
        saveText(
          text,
          `Astrolabe guide ${guideId.slice(0, 8).replace(UNSAFE_FILE_CHARS, "")}.json`,
        );
        setBusy(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setBusy(false);
        setProblem(error instanceof Error ? error.message : "The export failed.");
      });
  };

  return (
    <div>
      <Button size="sm" onClick={run} disabled={busy}>
        {busy ? "Saving…" : "Save as guide file"}
      </Button>
      {problem === undefined ? null : (
        <Callout tone="danger" title="The guide file could not be created" live>
          {problem}
        </Callout>
      )}
    </div>
  );
}
