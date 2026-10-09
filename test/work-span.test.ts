import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildEmptyThinkingContinuation,
  buildToolOnlyContinuation,
  buildWorkSpan,
  buildStoryboard,
  type AssistantSceneSnapshot,
  type StoryboardToolSnapshot,
} from "../src/storyboard.ts";
import { renderStoryboardSceneLayout, renderStoryboardWorkSpanLayout } from "../src/storyboard-renderer.ts";
import type { GroupKind } from "../src/grouping.ts";
import type { ThemeLike } from "../src/renderer.ts";
import { DEFAULT_PRESENTATION_SETTINGS, normalizePresentationSettings } from "../src/presentation-settings.ts";

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
    hasThinking: thinking !== undefined && thinking.trim().length > 0,
    thinkingPresence: thinking === undefined ? "absent" : thinking.trim().length > 0 ? "visible" : "empty",
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
  it.each([undefined, "", " \t\n"])("adds one inert root for absent/empty source thinking %j", (thinking) => {
    const source = scene("empty", "call", "read", thinking);
    const before = JSON.stringify(source);
    const span = buildWorkSpan([source])!;
    const root = span.chapters[0]!.items[0]!;
    expect(root).toMatchObject({
      type: "synthetic-scene-root",
      reason: thinking === undefined ? "absent-thinking" : "empty-thinking",
    });
    expect("content" in root).toBe(false);
    expect("toolCallId" in root).toBe(false);
    expect(Object.isFrozen(root)).toBe(true);
    const renderGroup = () => ["", " Read 1 file", "  ● fixture.ts"];
    const work = renderStoryboardWorkSpanLayout(span, 80, theme, renderGroup);
    const single = renderStoryboardSceneLayout(source, source.assistant.renderedAssistantLines, 80, theme, renderGroup);
    expect(single.lines).toEqual(work.lines);
    expect(work.lines.join("\n").match(/Thinking\.\.\./gu)).toHaveLength(1);
    expect(work.lines.join("\n")).toContain("╰─ Read 1 file");
    expect(work.assistantRegions).toHaveLength(0);
    expect(buildEmptyThinkingContinuation([source, scene("next", "next", "read")])).toBeUndefined();
    expect(JSON.stringify(source)).toBe(before);
  });

  it("does not reinterpret render-hidden real reasoning as source-empty", () => {
    const source = scene("hidden", "call", "read", "source thought");
    const thinking = source.orderedChildren![0]!;
    if (thinking.type !== "assistant") throw new Error("expected thinking");
    const hidden = {
      ...source,
      assistant: { ...source.assistant, renderedAssistantLines: [] },
      orderedChildren: [
        { ...thinking, content: { ...thinking.content, renderedLines: [] } },
        ...source.orderedChildren!.slice(1),
      ],
    };
    const span = buildWorkSpan([hidden])!;
    expect(span.chapters[0]!.items.map((item) => item.type)).toEqual(["action"]);
    expect(renderStoryboardSceneLayout(hidden, [], 80, theme, () => ["", " read 1"]).lines.join("\n"))
      .not.toContain("Thinking...");
  });

  it.each(["running", "failed", "complete"] as const)("uses assistant lifecycle color for a %s source-empty root", (state) => {
    const source = { ...scene("state", "call", "read"), state };
    const colors: string[] = [];
    const coloredTheme: ThemeLike = { fg: (color, text) => { if (text === "◉") colors.push(color); return text; } };
    const span = buildWorkSpan([source])!;
    const rendered = renderStoryboardWorkSpanLayout(span, 80, coloredTheme, () => ["", " read 1"]);
    expect(rendered.lines.join("\n")).toContain("Thinking...");
    expect(colors).toEqual([state === "running" ? "syntaxKeyword" : "success"]);
  });

  it("fits explicit roots and configured symbols at every width 1–200", () => {
    const span = buildWorkSpan([scene("narrow", "call", "read")])!;
    const custom = normalizePresentationSettings({ "pi-storyboard": {
      symbols: { thinkingRoot: "ROOT", rail: "RAIL", branch: "BRANCH", lastBranch: "END" },
    } });
    for (const settings of [DEFAULT_PRESENTATION_SETTINGS, custom]) {
      for (let width = 1; width <= 200; width++) {
        const output = renderStoryboardWorkSpanLayout(span, width, theme, () => ["", " Read 1 file", "  ● 文件.ts"], settings);
        expect(output.lines.length).toBeGreaterThan(0);
        expect(output.lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      }
    }
  });
  it("keeps separate turns in separate spans with an explicit source-empty UI root", () => {
    const first = scene("a", "a", "read", "inspect");
    const second = scene("b", "b", "read");
    const firstSpan = buildWorkSpan([first]);
    const secondSpan = buildWorkSpan([second]);
    expect(buildWorkSpan([first, second])).toBeUndefined();
    expect(firstSpan?.chapters[0]?.items.map((item) => item.type)).toEqual(["thinking", "action"]);
    expect(secondSpan?.chapters[0]?.items.map((item) => item.type)).toEqual(["synthetic-scene-root", "action"]);
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

  it("coalesces adjacent tool-only scenes under one inert source-empty root", () => {
    const first = scene("a", "a", "read");
    const second = scene("b", "b", "read", "");
    const third = scene("c", "c", "command");
    const span = buildToolOnlyContinuation([first, second, third]);

    expect(span?.scenes).toEqual([first, second, third]);
    expect(span?.chapters[0]?.items.map((item) => item.type)).toEqual([
      "synthetic-scene-root",
      "action",
      "action",
      "action",
    ]);
    const items = span!.chapters[0]!.items;
    expect(items[0]).toMatchObject({ type: "synthetic-scene-root", reason: "absent-thinking", scene: first });
    expect(items[1]).toMatchObject({ type: "action", scene: first, run: { kind: "read", rows: [{ toolCallId: "a" }] } });
    expect(items[2]).toMatchObject({ type: "action", scene: second, run: { kind: "read", rows: [{ toolCallId: "b" }] } });
    expect(items[3]).toMatchObject({ type: "action", scene: third, run: { kind: "command", rows: [{ toolCallId: "c" }] } });
    const layout = renderStoryboardWorkSpanLayout(
      span!,
      80,
      theme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    const output = layout.lines.join("\\n");
    expect(output.match(/◉/gu)).toHaveLength(1);
    expect(output).toContain("├─ read 2");
    expect(output).toContain("╰─ command 1");
    expect(output.match(/Thinking\.\.\./gu)).toHaveLength(1);
  });

  it("rejects tool-only continuation with fewer than two scenes, thinking, or text", () => {
    const empty = scene("empty", "empty", "read");
    const visible = scene("visible", "visible", "read", "thought");
    const commentary = scene("commentary", "commentary", "read", undefined, "status");

    expect(buildToolOnlyContinuation([empty])).toBeUndefined();
    expect(buildToolOnlyContinuation([empty, visible])).toBeUndefined();
    expect(buildToolOnlyContinuation([visible, empty])).toBeUndefined();
    expect(buildToolOnlyContinuation([empty, commentary])).toBeUndefined();
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

  it("starts tools after leading commentary with a source-empty UI root", () => {
    const second = scene("b", "b", "edit", undefined, "Applying the fix");
    const span = buildWorkSpan([second]);
    expect(span?.chapters[0]?.items.map((item) => item.type)).toEqual(["synthetic-scene-root", "action"]);
    const layout = renderStoryboardWorkSpanLayout(
      span!,
      80,
      theme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    const output = layout.lines.join("\n");
    expect(output).toContain("◉ Thinking...");
    expect(output).toContain("╰─ edit 1");
    expect(output.indexOf("Thinking...")).toBeGreaterThan(output.indexOf("Applying the fix"));
    expect(output).not.toContain("◉ edit 1");
  });
});
