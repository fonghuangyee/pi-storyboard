import { readFileSync } from "node:fs";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { buildSessionProjection } from "../src/session-projection.ts";

type SchemaNode = {
  $ref?: string;
  $comment?: string;
  $defs?: Record<string, SchemaNode>;
  oneOf?: SchemaNode[];
  allOf?: SchemaNode[];
  properties?: Record<string, SchemaNode>;
  const?: unknown;
  not?: { enum?: string[]; const?: unknown };
};

const schema = JSON.parse(readFileSync(new URL("../schema/pi-session.schema.json", import.meta.url), "utf8")) as SchemaNode;
const fixture = JSON.parse(readFileSync(new URL("./fixtures/no-thinking-transcript.json", import.meta.url), "utf8")) as {
  leafId: string;
  entries: SessionEntry[];
};

function walk(value: unknown, visit: (node: SchemaNode) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
  } else if (value !== null && typeof value === "object") {
    visit(value as SchemaNode);
    Object.values(value).forEach((item) => walk(item, visit));
  }
}

function discriminator(node: SchemaNode, field: string): unknown {
  return node.properties?.[field]?.const
    ?? node.allOf?.map((part) => discriminator(part, field)).find((value) => value !== undefined);
}

function freezeTree(value: unknown): void {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freezeTree);
  }
}

describe("development transcript schema reference", () => {
  it("pins evidence and resolves every reference locally", () => {
    expect(schema.$comment).toContain("6fb2e7815167e6b19006fc526d1a5d0f5f998787");
    expect(schema.$comment).toContain("d981de1229ef899957bbe968bc8dcda02a21f477");
    const refs: string[] = [];
    walk(schema, (node) => {
      if (node.$ref !== undefined) {
        refs.push(node.$ref);
        expect(node.$ref).toMatch(/^#\/\$defs\//u);
        expect(schema.$defs?.[node.$ref.slice("#/$defs/".length)]).toBeDefined();
      }
    });
    expect(refs.length).toBeGreaterThan(50);
  });

  it("inventories every reviewed entry and role without rescuing malformed known discriminators", () => {
    const defs = schema.$defs!;
    const entryKinds = defs.SessionEntry!.oneOf!
      .map((node) => discriminator(defs[node.$ref!.slice("#/$defs/".length)]!, "type"))
      .filter((kind) => kind !== undefined);
    expect(entryKinds).toEqual([
      "message", "thinking_level_change", "model_change", "usage", "compaction",
      "branch_summary", "custom", "custom_message", "context_edit", "label", "session_info",
    ]);
    expect(defs.UnknownEntry!.allOf![1]!.properties!.type!.not!.enum).toEqual(["session", ...entryKinds]);
    expect(defs.UnknownMessage!.properties!.role!.not!.enum).toEqual([
      "system", "user", "assistant", "toolResult", "bashExecution", "custom", "branchSummary", "compactionSummary",
    ]);
    expect(defs.AssistantMessage!.allOf![1]!.properties!.stopReason!.not!.const).toBe("pending");
  });
});

describe("sanitized no-thinking incident structure (current behavior, not the proposed visual fix)", () => {
  it("proves all four separate owners without inventing visible thinking or mutating source", () => {
    const original = JSON.stringify(fixture);
    freezeTree(fixture);
    const projection = buildSessionProjection(fixture);
    expect(projection).toBeDefined();
    expect(projection!.turns.map((turn) => ({
      entryId: turn.entryId,
      callIds: turn.toolCallIds,
      resultIds: turn.resultEntryIds,
      thinking: turn.hasVisibleThinking,
      valid: turn.valid,
    }))).toEqual([
      { entryId: "assistant-a", callIds: ["call-a1", "call-a2", "call-a3", "call-a4"], resultIds: ["result-a1", "result-a2", "result-a3", "result-a4"], thinking: false, valid: true },
      { entryId: "assistant-b", callIds: ["call-b1", "call-b2"], resultIds: ["result-b1", "result-b2"], thinking: false, valid: true },
      { entryId: "assistant-c", callIds: ["call-c1"], resultIds: ["result-c1"], thinking: false, valid: true },
      { entryId: "assistant-d", callIds: ["call-d1", "call-d2", "call-d3", "call-d4"], resultIds: ["result-d1", "result-d2", "result-d3", "result-d4"], thinking: false, valid: true },
    ]);
    expect(projection!.turns[0]!.boundaryBefore).toBe(true);
    expect(projection!.webSearchStatuses).toHaveLength(0);
    expect(JSON.stringify(fixture)).toBe(original);
  });

  it("rejects a visible custom interruption instead of swallowing it into tool ownership", () => {
    const interrupted = JSON.parse(JSON.stringify(fixture)) as typeof fixture;
    const stateIndex = interrupted.entries.findIndex((entry) => entry.id === "state-b");
    interrupted.entries[stateIndex] = {
      type: "custom_message", id: "state-b", parentId: "assistant-b",
      timestamp: "2026-01-01T00:00:00Z", customType: "fixture-status", content: "Visible boundary", display: true,
    };
    const projection = buildSessionProjection(interrupted);
    expect(projection?.turns.find((turn) => turn.entryId === "assistant-b")?.valid).toBe(false);
  });

  it("keeps latest-schema usage recognition separate from current runtime compatibility", () => {
    const unsupported = JSON.parse(JSON.stringify(fixture)) as typeof fixture;
    // The development schema knows usage; the baseline projector deliberately does not.
    unsupported.entries[0] = {
      type: "usage", id: "user", parentId: null, timestamp: "2026-01-01T00:00:00Z",
      kind: "cache_warm", provider: "fixture", model: "fixture",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as unknown as SessionEntry;
    expect(buildSessionProjection(unsupported)).toBeUndefined();
  });
});
