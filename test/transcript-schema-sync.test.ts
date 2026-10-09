import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectSnapshot, compareSnapshots, type TranscriptTypeSnapshot } from "../scripts/sync-transcript-schema.mjs";

const reviewed = JSON.parse(readFileSync(new URL("../schema/pi-transcript-types.json", import.meta.url), "utf8")) as TranscriptTypeSnapshot;

describe("Pi transcript declaration sync helper", () => {
  it("matches the reviewed snapshot to the installed Pi declarations", () => {
    const installed = collectSnapshot();
    expect(installed).toEqual(reviewed);
    expect(compareSnapshots(reviewed, installed).changed).toBe(false);
  });

  it("reports package, entry-union, and message-shape changes without accepting them", () => {
    const changed = structuredClone(reviewed);
    changed.packages["@earendil-works/pi-coding-agent"] = "0.86.0";
    const sessionManager = changed.sources.find((source) => source.id === "coding-agent/session-manager")!;
    sessionManager.declarations.SessionEntry += " | NewTranscriptEntry";
    const aiTypes = changed.sources.find((source) => source.id === "pi-ai/transcript-types")!;
    aiTypes.declarations.AssistantMessage += "\n    providerMetadata?: unknown;";
    const comparison = compareSnapshots(reviewed, changed);

    expect(comparison.changed).toBe(true);
    expect(comparison.packageChanges).toContainEqual({
      name: "@earendil-works/pi-coding-agent", before: "0.85.1", after: "0.86.0",
    });
    expect(comparison.sourceChanges.find((source) => source.id === "coding-agent/session-manager")?.declarations)
      .toContainEqual(expect.objectContaining({ name: "SessionEntry", kind: "changed" }));
    expect(comparison.sourceChanges.find((source) => source.id === "pi-ai/transcript-types")?.declarations)
      .toContainEqual(expect.objectContaining({ name: "AssistantMessage", kind: "changed" }));
  });
});
