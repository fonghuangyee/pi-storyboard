import { describe, expect, it } from "vitest";
import {
  buildStoryboard,
  deriveSceneState,
  type AssistantSceneSnapshot,
  type StoryboardChild,
  type StoryboardToolSnapshot,
} from "../src/storyboard.ts";
import type { GroupKind } from "../src/grouping.ts";

const success = Object.freeze({ content: Object.freeze([]), isError: false });
const failure = Object.freeze({ content: Object.freeze([]), isError: true });

function assistant(
  expectedToolCallIds: readonly string[] = [],
  overrides: Partial<AssistantSceneSnapshot> = {},
): AssistantSceneSnapshot {
  return {
    assistantRow: overrides.assistantRow ?? `assistant:${expectedToolCallIds.join(",")}`,
    renderedAssistantLines: overrides.renderedAssistantLines ?? ["thinking"],
    expectedToolCallIds,
    stopReason: overrides.stopReason ?? "stop",
    isStreaming: overrides.isStreaming ?? false,
    hasThinking: overrides.hasThinking ?? true,
    hasText: overrides.hasText ?? false,
    hasFinalAnswer: overrides.hasFinalAnswer ?? false,
    hasUnknownText: overrides.hasUnknownText ?? false,
    ...(overrides.assistantContent === undefined ? {} : { assistantContent: overrides.assistantContent }),
    ...(overrides.sourceOrder === undefined ? {} : { sourceOrder: overrides.sourceOrder }),
  };
}

function tool(
  toolCallId: string,
  kind: GroupKind,
  overrides: Partial<StoryboardToolSnapshot["snapshot"]> = {},
): StoryboardToolSnapshot {
  const toolName = kind === "command" ? "bash" : kind === "search" ? "grep" : kind;
  return {
    toolRow: `tool:${toolCallId}`,
    toolCallId,
    kind,
    snapshot: {
      toolName,
      args: { path: `${toolCallId}.ts` },
      result: success,
      isPartial: false,
      expanded: false,
      ...overrides,
    },
  };
}

function assistantChild(value: AssistantSceneSnapshot): StoryboardChild {
  return { type: "assistant", assistant: value };
}

function toolChild(value: StoryboardToolSnapshot): StoryboardChild {
  return { type: "tool", tool: value };
}

function nativeChild(row: string): StoryboardChild {
  return { type: "native", row };
}

function orderedAssistant(
  expectedToolCallIds: readonly string[],
  sourceOrder: AssistantSceneSnapshot["sourceOrder"],
  assistantContent: AssistantSceneSnapshot["assistantContent"],
): AssistantSceneSnapshot {
  return assistant(expectedToolCallIds, {
    assistantContent,
    sourceOrder,
  });
}

function sceneFrom(result: ReturnType<typeof buildStoryboard>, index = 0) {
  const scene = result.segments[index];
  expect(scene?.type).toBe("scene");
  if (scene?.type !== "scene") throw new Error("expected scene");
  return scene;
}

describe("buildStoryboard", () => {
  it("keeps mixed action kinds under one assistant scene in source order", () => {
    const result = buildStoryboard([
      assistantChild(assistant(["r1", "r2", "b1", "e1"])),
      toolChild(tool("r1", "read")),
      toolChild(tool("r2", "read")),
      toolChild(tool("b1", "command")),
      toolChild(tool("e1", "edit")),
    ]);

    const scene = sceneFrom(result);
    expect(scene.state).toBe("complete");
    expect(scene.actionRuns.map((run) => [run.kind, run.rows.map((row) => row.toolCallId)])).toEqual([
      ["read", ["r1", "r2"]],
      ["command", ["b1"]],
      ["edit", ["e1"]],
    ]);
  });

  it("does not merge non-adjacent groups of the same kind", () => {
    const result = buildStoryboard([
      assistantChild(assistant(["r1", "b1", "r2"])),
      toolChild(tool("r1", "read")),
      toolChild(tool("b1", "command")),
      toolChild(tool("r2", "read")),
    ]);

    expect(sceneFrom(result).actionRuns.map((run) => run.kind)).toEqual([
      "read",
      "command",
      "read",
    ]);
  });

  it("preserves thinking and tool source order while ending runs at thinking", () => {
    const firstThinking = { type: "thinking" as const, row: "thinking-1", renderedLines: [" first thinking"] };
    const secondThinking = { type: "thinking" as const, row: "thinking-2", renderedLines: [" second thinking"] };
    const result = buildStoryboard([
      assistantChild(orderedAssistant(
        ["read-1", "read-2"],
        [
          { type: "assistant", contentIndex: 0 },
          { type: "tool", toolCallId: "read-1" },
          { type: "assistant", contentIndex: 1 },
          { type: "tool", toolCallId: "read-2" },
        ],
        [firstThinking, secondThinking],
      )),
      toolChild(tool("read-2", "read")),
      toolChild(tool("read-1", "read")),
    ]);

    const scene = sceneFrom(result);
    expect(scene.orderedChildren?.map((child) =>
      child.type === "tool" ? `tool:${child.tool.toolCallId}` : `assistant:${child.content.type}`,
    )).toEqual(["assistant:thinking", "tool:read-1", "assistant:thinking", "tool:read-2"]);
    expect(scene.actionRuns.map((run) => run.rows.map((row) => row.toolCallId))).toEqual([
      ["read-1"],
      ["read-2"],
    ]);
  });

  it("creates a quiet thinking note but leaves a final answer native", () => {
    const note = assistant([], { assistantRow: "note", hasThinking: true, hasText: false });
    const finalAnswer = assistant([], {
      assistantRow: "final",
      renderedAssistantLines: ["final answer"],
      hasThinking: false,
      hasText: true,
      hasFinalAnswer: true,
    });
    const result = buildStoryboard([assistantChild(note), assistantChild(finalAnswer)]);

    expect(sceneFrom(result).state).toBe("note");
    expect(result.segments[1]).toEqual({
      type: "native",
      children: [assistantChild(finalAnswer)],
    });
  });

  it("supports a direct-root tool-only turn when ownership is explicit", () => {
    const owner = assistant(["write-1"], {
      assistantRow: "tool-only",
      renderedAssistantLines: [],
      hasThinking: false,
      hasText: false,
    });
    const result = buildStoryboard([assistantChild(owner), toolChild(tool("write-1", "write"))]);

    const scene = sceneFrom(result);
    expect(scene.state).toBe("complete");
    expect(scene.assistant.renderedAssistantLines).toEqual([]);
    expect(scene.actionRuns[0]?.rows[0]?.toolCallId).toBe("write-1");
  });

  it("maps direct tool rows back to assistant source order", () => {
    const owner = assistant(["a", "b"]);
    const children = [
      assistantChild(owner),
      toolChild(tool("b", "command")),
      toolChild(tool("a", "read")),
    ];
    const result = buildStoryboard(children);

    const scene = sceneFrom(result);
    expect(scene.actionRuns.map((run) => [run.kind, run.rows.map((row) => row.toolCallId)])).toEqual([
      ["read", ["a"]],
      ["command", ["b"]],
    ]);
  });

  it.each([
    {
      name: "missing call",
      expected: ["a", "b"],
      actual: [tool("a", "read")],
    },
    {
      name: "extra call",
      expected: ["a"],
      actual: [tool("a", "read"), tool("b", "command")],
    },
  ])("falls back natively for $name", ({ expected, actual }) => {
    const owner = assistant(expected);
    const children = [assistantChild(owner), ...actual.map(toolChild)];
    const result = buildStoryboard(children);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toEqual({ type: "native", children });
  });

  it("treats a visible native child as an ownership boundary", () => {
    const owner = assistant(["a", "b"]);
    const children = [
      assistantChild(owner),
      toolChild(tool("a", "read")),
      nativeChild("unrelated native row"),
      toolChild(tool("b", "command")),
    ];

    const result = buildStoryboard(children);
    expect(result.segments).toEqual([{ type: "native", children }]);
  });

  it("never groups an expanded tool or a tool from an assistant claiming no calls", () => {
    const expandedOwner = assistant(["expanded"]);
    const expanded = tool("expanded", "read", { expanded: true });
    const noCallOwner = assistant([]);
    const unowned = tool("unowned", "command");
    const result = buildStoryboard([
      assistantChild(expandedOwner),
      toolChild(expanded),
      assistantChild(noCallOwner),
      toolChild(unowned),
    ]);

    expect(result.segments.every((segment) => segment.type === "native")).toBe(true);
    expect(result.segments.flatMap((segment) => segment.type === "native" ? segment.children : [])).toEqual([
      assistantChild(expandedOwner),
      toolChild(expanded),
      assistantChild(noCallOwner),
      toolChild(unowned),
    ]);
  });

  it("preserves internal response-state precedence", () => {
    const completeOwner = assistant(["ok"]);
    const failedTool = tool("failed", "command", { result: failure });

    expect(deriveSceneState(completeOwner, [tool("ok", "read")] )).toBe("complete");
    expect(deriveSceneState(completeOwner, [failedTool])).toBe("failed");
    expect(deriveSceneState(
      assistant(["pending"], { isStreaming: true }),
      [tool("pending", "read", { isPartial: true, result: failure })],
    )).toBe("running");
    expect(deriveSceneState(assistant([], { hasThinking: true, hasText: false }), [])).toBe("note");
  });

  it("keeps final or unclassified text with tools completely native", () => {
    for (const unsafe of [
      assistant(["read-1"], { hasText: true, hasFinalAnswer: true }),
      assistant(["read-1"], { hasText: true, hasUnknownText: true }),
    ]) {
      const children = [assistantChild(unsafe), toolChild(tool("read-1", "read"))];
      expect(buildStoryboard(children).segments).toEqual([{ type: "native", children }]);
    }
  });

  it("allows validated commentary to remain native content inside a turn block", () => {
    const commentary = {
      type: "commentary" as const,
      row: "commentary",
      renderedLines: [" user-visible update"],
    };
    const owner = assistant(["read-1"], {
      hasText: true,
      assistantContent: [commentary],
      sourceOrder: [
        { type: "assistant", contentIndex: 0 },
        { type: "tool", toolCallId: "read-1" },
      ],
    });
    const scene = sceneFrom(buildStoryboard([
      assistantChild(owner),
      toolChild(tool("read-1", "read")),
    ]));

    expect(scene.orderedChildren?.[0]).toEqual({ type: "assistant", content: commentary });
  });

  it("rejects duplicate ownership IDs instead of guessing", () => {
    const owner = assistant(["same", "same"]);
    const children = [
      assistantChild(owner),
      toolChild(tool("same", "read")),
      toolChild(tool("same", "read")),
    ];

    expect(buildStoryboard(children).segments).toEqual([{ type: "native", children }]);
  });
});
