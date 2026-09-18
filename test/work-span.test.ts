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
    ...(commentary === undefined
      ? []
      : [{
          type: "commentary" as const,
          row: `${id}:commentary`,
          renderedLines: commentary.split("\n").map((line) => ` ${line}`),
        }]),
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
    const third = scene("c", "c", "read");
    const fourth = scene("d", "d", "command");
    const span = buildEmptyThinkingContinuation([first, second, third, fourth]);

    expect(span?.scenes).toHaveLength(4);
    expect(span?.chapters[0]?.items.map((item) => item.type)).toEqual([
      "thinking",
      "action",
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
    expect(output).toContain("├─ read 3");
    expect(output).not.toContain("read 1");
    expect(output).toContain("╰─ command 1");
    expect(output).not.toContain("Thinking...");
  });

  it("rejects a continuation across visible text or a missing anchor", () => {
    const visible = scene("a", "a", "read", "inspect");
    const visibleThinking = scene("b", "b", "read", "next");
    const text = scene("c", "c", "read", undefined, "commentary");
    const empty = scene("d", "d", "read");

    expect(buildEmptyThinkingContinuation([visible, visibleThinking])).toBeUndefined();
    expect(buildEmptyThinkingContinuation([visible, text])).toBeUndefined();
    expect(buildEmptyThinkingContinuation([empty, visible])).toBeUndefined();
  });

  it("uses a presentation-only thinking placeholder after commentary", () => {
    const second = scene("b", "b", "edit", "fix", "Applying the fix");
    const span = buildWorkSpan([second]);
    expect(span?.parts.map((part) => part.type)).toEqual(["chapter", "commentary", "chapter"]);
    expect(span?.chapters[1]?.items.map((item) => item.type)).toEqual([
      "synthetic-thinking-placeholder",
      "action",
    ]);
    const layout = renderStoryboardWorkSpanLayout(
      span!,
      80,
      theme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    const output = layout.lines.join("\n");
    expect(output).toContain("◉ fix");
    expect(output).toContain("Applying the fix");
    expect(output).toContain("◉ Thinking...");
    expect(output).toContain("╰─ edit 1");
    expect(output).not.toContain("◉ edit 1");
    expect(layout.lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
  });

  it("uses native thinking emphasis for the synthetic placeholder", () => {
    const second = scene("b", "b", "edit", "fix", "Applying the fix");
    const styledTheme: ThemeLike = {
      fg: (_color, text) => text,
      bold: (text) => `<bold>${text}</bold>`,
      italic: (text) => `<italic>${text}</italic>`,
    };
    const span = buildWorkSpan([second]);
    const layout = renderStoryboardWorkSpanLayout(
      span!,
      80,
      styledTheme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    expect(layout.lines.join("\n")).toContain("<bold><italic>Thinking...</italic></bold>");
  });

  it("keeps multiline commentary full-width and source ordered before the suffix", () => {
    const second = scene("b", "b", "command", "fix", "first commentary line\nsecond commentary line");
    const span = buildWorkSpan([second]);
    const layout = renderStoryboardWorkSpanLayout(
      span!,
      40,
      theme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    const output = layout.lines.join("\n");
    expect(output.indexOf("first commentary line")).toBeGreaterThan(output.indexOf("fix"));
    expect(output.indexOf("second commentary line")).toBeGreaterThan(output.indexOf("first commentary line"));
    expect(output.indexOf("Thinking...")).toBeGreaterThan(output.indexOf("second commentary line"));
    expect(output.indexOf("╰─ command 1")).toBeGreaterThan(output.indexOf("Thinking..."));
    expect(output).not.toContain("│ first commentary line");
    expect(output).not.toContain("│ second commentary line");
    expect(layout.lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
  });

  it("does not synthesize a placeholder when commentary has no preceding thinking", () => {
    const second = scene("b", "b", "edit", undefined, "Applying the fix");
    const span = buildWorkSpan([second]);
    expect(span?.chapters[0]?.items.map((item) => item.type)).toEqual(["action"]);
    const layout = renderStoryboardWorkSpanLayout(
      span!,
      80,
      theme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    const output = layout.lines.join("\n");
    expect(output).toContain("◉ edit 1");
    expect(output).not.toContain("Thinking...");
  });
});
