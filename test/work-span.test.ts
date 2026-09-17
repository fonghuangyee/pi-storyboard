import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildEmptyThinkingContinuation,
  buildWorkSpan,
  buildStoryboard,
  type AssistantSceneSnapshot,
  type StoryboardToolSnapshot,
} from "../src/storyboard.ts";
import { renderStoryboardWorkSpanLayout } from "../src/storyboard-renderer.ts";
import type { GroupKind } from "../src/grouping.ts";
import type { ThemeLike } from "../src/renderer.ts";

const theme: ThemeLike = { fg: (_color, text) => text, bold: (text) => text };
const ok = { content: [], isError: false } as const;

function scene(id: string, callId: string, kind: GroupKind, thinking?: string, commentary?: string) {
  const content = [
    ...(thinking === undefined ? [] : [{ type: "thinking" as const, row: `${id}:thinking`, renderedLines: [` ${thinking}`] }]),
    ...(commentary === undefined ? [] : [{ type: "commentary" as const, row: `${id}:commentary`, renderedLines: [` ${commentary}`] }]),
  ];
  const assistant: AssistantSceneSnapshot = {
    assistantRow: `${id}:assistant`,
    renderedAssistantLines: ["", ...(content.flatMap((item) => item.renderedLines))],
    expectedToolCallIds: [callId],
    stopReason: "stop",
    isStreaming: false,
    hasThinking: thinking !== undefined,
    hasText: commentary !== undefined,
    hasFinalAnswer: false,
    hasUnknownText: false,
    assistantContent: content,
    sourceOrder: [
      ...content.map((_item, index) => ({ type: "assistant" as const, contentIndex: index })),
      { type: "tool" as const, toolCallId: callId },
    ],
  };
  const tool: StoryboardToolSnapshot = {
    toolRow: `${id}:tool`,
    toolCallId: callId,
    kind,
    snapshot: { toolName: kind === "command" ? "bash" : kind, args: { path: `${id}.ts` }, result: ok, isPartial: false, expanded: false },
  };
  const built = buildStoryboard([{ type: "assistant", assistant }, { type: "tool", tool }]);
  const result = built.segments[0];
  if (result?.type !== "scene") throw new Error("expected scene");
  return result;
}

describe("work-span projection", () => {
  it("keeps separate turns in separate spans and omits empty thinking", () => {
    const first = scene("a", "a", "read", "inspect");
    const second = scene("b", "b", "read");
    const firstSpan = buildWorkSpan([first]);
    const secondSpan = buildWorkSpan([second]);
    expect(buildWorkSpan([first, second])).toBeUndefined();
    expect(firstSpan?.chapters[0]?.items.map((item) => item.type)).toEqual(["thinking", "action"]);
    expect(secondSpan?.chapters[0]?.items.map((item) => item.type)).toEqual(["action"]);
  });

  it("continues adjacent empty-thinking actions under the previous visible root", () => {
    const first = scene("a", "a", "read", "inspect");
    const second = scene("b", "b", "read");
    const third = scene("c", "c", "command");
    const span = buildEmptyThinkingContinuation([first, second, third]);

    expect(span?.scenes).toHaveLength(3);
    expect(span?.chapters[0]?.items.map((item) => item.type)).toEqual([
      "thinking",
      "action",
      "action",
      "action",
    ]);
    const layout = renderStoryboardWorkSpanLayout(
      span!,
      80,
      theme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    const output = layout.lines.join("\\n");
    expect(output.match(/◉/gu)).toHaveLength(1);
    expect(output).toContain("├─ read 1");
    expect(output).toContain("╰─ command 1");
    expect(output).not.toContain("Thinking...");
  });

  it("rejects a continuation across visible text or a missing anchor", () => {
    const visible = scene("a", "a", "read", "inspect");
    const text = scene("b", "b", "read", undefined, "commentary");
    const empty = scene("c", "c", "read");

    expect(buildEmptyThinkingContinuation([visible, text])).toBeUndefined();
    expect(buildEmptyThinkingContinuation([empty, visible])).toBeUndefined();
  });

  it("uses an observable action as the root and breaks out commentary", () => {
    const second = scene("b", "b", "edit", "fix", "Applying the fix");
    const span = buildWorkSpan([second]);
    expect(span?.parts.map((part) => part.type)).toEqual(["chapter", "commentary", "chapter"]);
    const layout = renderStoryboardWorkSpanLayout(
      span!,
      80,
      theme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    const output = layout.lines.join("\n");
    expect(output).toContain("◉");
    expect(output).toContain("Applying the fix");
    expect(output).toContain("◉ edit 1");
    expect(output).not.toContain("Thinking...");
    expect(layout.lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
  });
});
