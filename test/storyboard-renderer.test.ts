import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderStoryboardScene, sceneMarkerColor } from "../src/storyboard-renderer.ts";
import { buildStoryboard, type StoryboardChild } from "../src/storyboard.ts";
import type { ThemeLike } from "../src/renderer.ts";

const theme: ThemeLike = {
  fg: (color, text) => `<${color}>${text}`,
  bold: (text) => text,
};

function scene(): Extract<ReturnType<typeof buildStoryboard>["segments"][number], { type: "scene" }> {
  const children: StoryboardChild[] = [
    {
      type: "assistant",
      assistant: {
        assistantRow: "assistant",
        renderedAssistantLines: [" assistant work"],
        expectedToolCallIds: ["read-1"],
        stopReason: "stop",
        isStreaming: false,
        hasThinking: true,
        hasText: false,
      },
    },
    {
      type: "tool",
      tool: {
        toolRow: "read",
        toolCallId: "read-1",
        kind: "read",
        snapshot: {
          toolName: "read",
          args: { path: "src/a.ts" },
          result: { content: [], isError: false },
          isPartial: false,
          expanded: false,
        },
      },
    },
  ];
  const result = buildStoryboard(children).segments[0];
  if (result?.type !== "scene") throw new Error("expected scene");
  return result;
}

describe("storyboard renderer", () => {
  it("maps scene state to the agreed marker colors", () => {
    expect(sceneMarkerColor("running")).toBe("syntaxKeyword");
    expect(sceneMarkerColor("failed")).toBe("error");
    expect(sceneMarkerColor("complete")).toBe("success");
    expect(sceneMarkerColor("note")).toBe("muted");
  });

  it("keeps thinking runs between tool groups in source order", () => {
    const base = scene();
    const firstTool = base.actionRuns[0]!.rows[0]!;
    const secondTool = {
      ...firstTool,
      toolCallId: "read-2",
      toolRow: "read-2",
    };
    const firstThinking = {
      type: "thinking" as const,
      row: "thinking-1",
      renderedLines: [" first thinking"],
    };
    const secondThinking = {
      type: "thinking" as const,
      row: "thinking-2",
      renderedLines: [" second thinking"],
    };
    const ordered = {
      ...base,
      actionRuns: [
        { kind: "read" as const, rows: [firstTool] },
        { kind: "read" as const, rows: [secondTool] },
      ],
      orderedChildren: [
        { type: "assistant" as const, content: firstThinking },
        { type: "tool" as const, tool: firstTool },
        { type: "assistant" as const, content: secondThinking },
        { type: "tool" as const, tool: secondTool },
      ],
    };
    const lines = renderStoryboardScene(
      ordered,
      ["", " first thinking", "", " second thinking"],
      100,
      theme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    const output = lines.join("\n");
    expect(output.indexOf("first thinking")).toBeLessThan(output.indexOf("read 1"));
    expect(output.indexOf("read 1")).toBeLessThan(output.indexOf("second thinking"));
    expect(output.indexOf("second thinking")).toBeLessThan(output.lastIndexOf("read 1"));
    expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
  });

  it("does not duplicate a native spacer around assistant text before tools", () => {
    const base = scene();
    const firstThinking = {
      type: "thinking" as const,
      row: "thinking-1",
      renderedLines: [" first thinking"],
    };
    const spacer = {
      type: "native" as const,
      row: "spacer",
      renderedLines: [""],
    };
    const text = {
      type: "text" as const,
      row: "text",
      renderedLines: [" I'll verify the payload"],
    };
    const tool = base.actionRuns[0]!.rows[0]!;
    const ordered = {
      ...base,
      orderedChildren: [
        { type: "assistant" as const, content: firstThinking },
        { type: "assistant" as const, content: spacer },
        { type: "assistant" as const, content: text },
        { type: "tool" as const, tool },
      ],
    };
    const lines = renderStoryboardScene(
      ordered,
      ["", " first thinking", "", " I'll verify the payload"],
      100,
      theme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    const textLine = lines.findIndex((line) => line.includes("I'll verify"));
    expect(textLine).toBeGreaterThan(1);
    expect(lines[textLine - 1]).toBe("   │");
    expect(lines[textLine - 2]).not.toBe("   │");
  });

  it("keeps the rail width-safe and delegates child groups with reduced width", () => {
    const widths: number[] = [];
    const lines = renderStoryboardScene(
      scene(),
      [` assistant work${" ".repeat(60)}`],
      80,
      theme,
      (group, width) => {
        widths.push(width);
        return ["", ` ${group.kind} 1 file`, "  ● src/a.ts"];
      },
    );

    expect(widths).toEqual([74]);
    expect(lines.join("\n")).toContain("<success>◉");
    expect(lines).toContain("   ╰─ read 1 file");
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);

    for (const width of [1, 10, 30, 49, 80, 120]) {
      const narrow = renderStoryboardScene(
        scene(),
        [" assistant work"],
        width,
        theme,
        () => ["", " heading", " row"],
      );
      expect(narrow.length).toBeGreaterThan(0);
      expect(narrow.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  it("keeps a streaming note as a note while using the running color", () => {
    const note = {
      ...scene(),
      state: "running" as const,
      actionRuns: [],
      assistant: {
        ...scene().assistant,
        expectedToolCallIds: [],
        isStreaming: true,
      },
    };
    const lines = renderStoryboardScene(note, [" reviewing logic"], 80, theme, () => [""]);

    expect(lines.join("\\n")).toContain("<syntaxKeyword>○");
    expect(lines.join("\\n")).not.toContain("<syntaxKeyword>◉");
    expect(lines.join("\\n")).toContain("note");
    expect(lines.join("\\n")).not.toContain("action");
  });

  it("uses the same narrow-width count rule for native and Tool step headers", () => {
    const toolOnly = scene();
    const emptyAssistant = {
      ...toolOnly.assistant,
      renderedAssistantLines: [],
    };
    const toolOnlyScene = { ...toolOnly, assistant: emptyAssistant };

    const narrow = renderStoryboardScene(toolOnlyScene, [], 70, theme, () => ["", " heading"]);
    expect(narrow.join("\\n")).toContain("Tool step");
    expect(narrow.join("\\n")).not.toContain("1 action");

    const wide = renderStoryboardScene(toolOnlyScene, [], 100, theme, () => ["", " heading"]);
    expect(wide.join("\\n")).toContain("1 action");
  });
});
