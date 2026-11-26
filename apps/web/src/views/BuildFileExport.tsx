import { useEffect, useRef, useState } from "react";
import { Button, Callout } from "@astrolabe/ui";
import { loadBuildFile, type BuildFileExport } from "../api/build-file";

/** Characters of the guide's name that are not safe in a file name. */
const UNSAFE_FILE_CHARS = /[^\p{L}\p{N} _-]+/gu;

function fileNameOf(name: string): string {
  const base = name.replace(UNSAFE_FILE_CHARS, "").trim();
  return `${base === "" ? "Astrolabe build" : base}.build`;
}

function save(file: BuildFileExport): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameOf(file.name);
  link.click();
  // The save starts synchronously on click; the URL is not needed afterwards.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Saves a finished guide as the game's `.build` file and says what the file lacks. */
export function BuildFileExportButton({ guideId }: { guideId: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [omitted, setOmitted] = useState<readonly string[] | undefined>(undefined);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);

  const run = () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setProblem(undefined);
    loadBuildFile(guideId, controller.signal).then(
      (file) => {
        if (controller.signal.aborted) return;
        setBusy(false);
        setOmitted(file.omitted);
        save(file);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setBusy(false);
        setProblem(error instanceof Error ? error.message : "The export failed.");
      },
    );
  };

  return (
    <div>
      <Button size="sm" onClick={run} disabled={busy}>
        {busy ? "Exporting…" : "Save as .build file"}
      </Button>
      {problem === undefined ? null : (
        <Callout tone="danger" title="The file could not be created" live>
          {problem}
        </Callout>
      )}
      {omitted === undefined || omitted.length === 0 ? null : (
        <Callout tone="warning" title="The file is missing some entries">
          The game data has no game id or name for these, so they are left out:
          <ul>
            {omitted.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  );
}
