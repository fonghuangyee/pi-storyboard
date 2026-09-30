import { describe, expect, it } from "vitest";
import { buildSessionProjection, matchesProjectedTurn } from "../src/session-projection.ts";

function entry(id: string, message: Record<string, unknown>, parentId: string | null = null) {
  return { type: "message", id, parentId, timestamp: "2026-01-01T00:00:00.000Z", message } as never;
}

function assistant(id: string, calls: string[], content: unknown[] = [], toolName = "read") {
  return entry(id, {
    role: "assistant",
    content: [
      ...content,
      ...calls.map((callId) => ({ type: "toolCall", id: callId, name: toolName, arguments: "{}" })),
    ],
  });
}

function result(id: string, callId: string, toolName = "read") {
  return entry(id, { role: "toolResult", toolCallId: callId, toolName, content: [], isError: false });
}

function webSearchStatus(id: string, content: string, parentId: string) {
  return {
    type: "custom_message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: "web-search-content-ready",
    content,
    display: true,
  } as never;
}

describe("buildSessionProjection", () => {
  it("projects exact tool ownership and transparent metadata entries", () => {
    const projection = buildSessionProjection({
      leafId: "r2",
      entries: [
        entry("u", { role: "user", content: "inspect" }),
        Object.assign(assistant("a1", ["c1"], [{ type: "thinking", thinking: "look" }]), { parentId: "u" }),
        Object.assign(result("r1", "c1"), { parentId: "a1" }),
        { type: "model_change", id: "m", parentId: "r1", timestamp: "now", provider: "x", modelId: "y" } as never,
        Object.assign(assistant("a2", ["c2"]), { parentId: "m" }),
        Object.assign(result("r2", "c2"), { parentId: "a2" }),
      ],
    });

    expect(projection?.turns.map((turn) => ({
      id: turn.entryId,
      calls: turn.toolCallIds,
      valid: turn.valid,
      before: turn.boundaryBefore,
      after: turn.boundaryAfter,
    }))).toEqual([
      { id: "a1", calls: ["c1"], valid: true, before: true, after: false },
      { id: "a2", calls: ["c2"], valid: true, before: false, after: false },
    ]);
    expect(matchesProjectedTurn(projection!.turns[0]!, ["c1"])).toBe(true);
  });

  it("breaks spans at visible messages and rejects dangling results", () => {
    const projection = buildSessionProjection({
      leafId: "a2",
      entries: [
        entry("root", { role: "user", content: "start" }),
        Object.assign(assistant("a1", ["c1"]), { parentId: "root" }),
        Object.assign(result("r1", "c1"), { parentId: "a1" }),
        Object.assign(entry("u", { role: "user", content: "continue" }), { parentId: "r1" }),
        Object.assign(assistant("a2", ["c2"]), { parentId: "u" }),
      ],
    });
    expect(projection?.turns[0]?.boundaryAfter).toBe(true);
    expect(projection?.turns[1]?.boundaryBefore).toBe(true);
    expect(projection?.turns[1]?.valid).toBe(false);
    expect(matchesProjectedTurn(projection!.turns[1]!, ["c2"])).toBe(false);
  });

  it("follows the selected leaf when given raw tree entries", () => {
    const root = entry("root", { role: "user", content: "start" }, null);
    const left = assistant("left", ["left-call"], [],);
    const leftResult = result("left-result", "left-call");
    const right = assistant("right", ["right-call"], [],);
    const rightResult = result("right-result", "right-call");
    (left as { parentId: string | null }).parentId = "root";
    (leftResult as { parentId: string | null }).parentId = "left";
    (right as { parentId: string | null }).parentId = "root";
    (rightResult as { parentId: string | null }).parentId = "right";
    const projection = buildSessionProjection({
      leafId: "right-result",
      entries: [root, left, leftResult, right, rightResult],
    });
    expect(projection?.turns.map((turn) => turn.entryId)).toEqual(["right"]);
  });

  it("accepts a compaction snapshot whose first kept entry has an omitted parent", () => {
    const projection = buildSessionProjection({
      leafId: "result",
      entries: [
        {
          type: "compaction",
          id: "compact",
          parentId: "old-parent",
          timestamp: "now",
          summary: "summary",
          firstKeptEntryId: "assistant",
          tokensBefore: 100,
        } as never,
        Object.assign(assistant("assistant", ["call"]), { parentId: "omitted-parent" }),
        Object.assign(result("result", "call"), { parentId: "assistant" }),
      ],
    });

    expect(projection?.turns).toHaveLength(1);
    expect(projection?.turns[0]?.valid).toBe(true);
  });

  it("treats a validated context edit as an invisible hard boundary", () => {
    const projection = buildSessionProjection({
      leafId: "r2",
      entries: [
        entry("root", { role: "user", content: "start" }),
        Object.assign(assistant("a1", ["c1"]), { parentId: "root" }),
        Object.assign(result("r1", "c1"), { parentId: "a1" }),
        {
          type: "context_edit",
          id: "edit",
          parentId: "r1",
          timestamp: "now",
          targetId: "a1",
          replacement: null,
        } as never,
        Object.assign(assistant("a2", ["c2"]), { parentId: "edit" }),
        Object.assign(result("r2", "c2"), { parentId: "a2" }),
      ],
    });

    expect(projection?.turns.map((turn) => ({
      id: turn.entryId,
      valid: turn.valid,
      before: turn.boundaryBefore,
      after: turn.boundaryAfter,
    }))).toEqual([
      { id: "a1", valid: true, before: true, after: true },
      { id: "a2", valid: true, before: true, after: false },
    ]);
  });

  it("rejects an incompatible context edit shape", () => {
    const projection = buildSessionProjection({
      leafId: "r1",
      entries: [
        entry("root", { role: "user", content: "start" }),
        Object.assign(assistant("a1", ["c1"]), { parentId: "root" }),
        Object.assign(result("r0", "c1"), { parentId: "a1" }),
        {
          type: "context_edit",
          id: "edit",
          parentId: "r0",
          timestamp: "now",
          targetId: "a1",
          replacement: { role: "assistant" },
        } as never,
        Object.assign(assistant("a2", ["c2"]), { parentId: "edit" }),
        Object.assign(result("r1", "c2"), { parentId: "a2" }),
      ],
    });

    expect(projection).toBeUndefined();
  });

  it("links a visible web-search status only through its exact active-path tool result", () => {
    const statusText = "Content fetched for 8/17 URLs [search-status].";
    const projection = buildSessionProjection({
      leafId: "status",
      entries: [
        entry("root", { role: "user", content: "search" }),
        Object.assign(assistant("search-assistant", ["search-call"], [], "web_search"), { parentId: "root" }),
        Object.assign(result("search-result", "search-call", "web_search"), { parentId: "search-assistant" }),
        Object.assign(webSearchStatus("status", statusText, "search-result"), { parentId: "search-result" }),
      ],
    });

    expect(projection?.webSearchStatuses).toEqual([{
      entryId: "status",
      assistantEntryId: "search-assistant",
      resultEntryId: "search-result",
      toolCallId: "search-call",
      content: statusText,
    }]);
    expect(projection?.turns[0]?.valid).toBe(true);
    expect(projection?.turns[0]?.boundaryAfter).toBe(true);
  });

  it("sanitizes and bounds retained web-search status text", () => {
    const unsafeStatus = `\u001b[31m${"x".repeat(520)}\u001b[0m`;
    const projection = buildSessionProjection({
      leafId: "status",
      entries: [
        entry("root", { role: "user", content: "search" }),
        Object.assign(assistant("search-assistant", ["search-call"], [], "web_search"), { parentId: "root" }),
        Object.assign(result("search-result", "search-call", "web_search"), { parentId: "search-assistant" }),
        Object.assign(webSearchStatus("status", unsafeStatus, "search-result"), { parentId: "search-result" }),
      ],
    });

    expect(projection?.webSearchStatuses?.[0]?.content).toBe("x".repeat(512));
  });

  it("does not infer a web-search link from a status adjacent to another tool", () => {
    const projection = buildSessionProjection({
      leafId: "status",
      entries: [
        entry("root", { role: "user", content: "read" }),
        Object.assign(assistant("assistant", ["call"]), { parentId: "root" }),
        Object.assign(result("result", "call"), { parentId: "assistant" }),
        Object.assign(webSearchStatus("status", "Fetched", "result"), { parentId: "result" }),
      ],
    });

    expect(projection?.webSearchStatuses).toEqual([]);
  });

  it("accepts validated commentary but not unknown text phase", () => {
    const projection = buildSessionProjection({
      leafId: "r2",
      entries: [
        entry("root", { role: "user", content: "start" }),
        Object.assign(assistant("a1", ["c1"], [{ type: "text", text: "update", textSignature: JSON.stringify({ v: 1, id: "t", phase: "commentary" }) }]), { parentId: "root" }),
        Object.assign(result("r1", "c1"), { parentId: "a1" }),
        Object.assign(assistant("a2", ["c2"], [{ type: "text", text: "answer" }]), { parentId: "r1" }),
        Object.assign(result("r2", "c2"), { parentId: "a2" }),
      ],
    });
    expect(projection?.turns[0]?.valid).toBe(true);
    expect(projection?.turns[0]?.hasCommentary).toBe(true);
    expect(projection?.turns[1]?.valid).toBe(false);
  });
});
