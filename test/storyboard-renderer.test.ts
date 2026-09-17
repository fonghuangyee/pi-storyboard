import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  renderNativeThinkingMarkersLayout,
  renderStoryboardScene,
  sceneMarkerColor,
  thinkingMarkerColor,
} from "../src/storyboard-renderer.ts";
import { buildStoryboard, type StoryboardChild } from "../src/storyboard.ts";
import { renderToolGroup, type ThemeLike } from "../src/renderer.ts";
import { normalizePresentationSettings } from "../src/presentation-settings.ts";

const theme: ThemeLike = {
  fg: (_color, text) => text,
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
        hasFinalAnswer: false,
        hasUnknownText: false,
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

describe("turn storyboard renderer", () => {
  it("maps story-block state to marker colors", () => {
    expect(sceneMarkerColor("running")).toBe("syntaxKeyword");
    expect(sceneMarkerColor("failed")).toBe("error");
    expect(sceneMarkerColor("complete")).toBe("success");
    expect(sceneMarkerColor("note")).toBe("muted");
  });

  it("keeps thinking markers limited to running and success", () => {
    expect(thinkingMarkerColor("running")).toBe("syntaxKeyword");
    expect(thinkingMarkerColor("failed")).toBe("success");
    expect(thinkingMarkerColor("complete")).toBe("success");
    expect(thinkingMarkerColor("note")).toBe("success");
  });

  it("renders ordered content under one thinking header and closes the final child", () => {
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
    expect(lines.filter((line) => line.includes("◉"))).toHaveLength(1);
    expect(output).toContain("├─ read 1");
    expect(output).toContain("╰─ read 1");
    expect(lines.at(-1)).toContain("╰─ read 1");
    expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
  });

  it("keeps rich commentary native beneath thinking instead of promoting it to the title", () => {
    const base = scene();
    const thinking = {
      type: "thinking" as const,
      row: "thinking",
      renderedLines: [" locating exact types"],
    };
    const spacer = {
      type: "native" as const,
      row: "spacer",
      renderedLines: [""],
    };
    const commentary = {
      type: "commentary" as const,
      row: "commentary",
      renderedLines: [
        " ## Findings",
        "",
        " - commentary can contain Markdown",
        " ```ts",
        " const final = false;",
        " ```",
      ],
    };
    const tool = base.actionRuns[0]!.rows[0]!;
    const ordered = {
      ...base,
      orderedChildren: [
        { type: "assistant" as const, content: thinking },
        { type: "assistant" as const, content: spacer },
        { type: "assistant" as const, content: commentary },
        { type: "tool" as const, tool },
      ],
    };
    const lines = renderStoryboardScene(
      ordered,
      ["", ...thinking.renderedLines, "", ...commentary.renderedLines],
      80,
      theme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    const output = lines.join("\n");
    expect(output).toContain("◉ locating exact types");
    expect(output).toContain("│ ## Findings");
    expect(output).toContain("│ - commentary can contain Markdown");
    expect(output).toContain("│ ```ts");
    expect(output.indexOf("Findings")).toBeLessThan(output.indexOf("read 1"));
    expect(output).toContain("╰─ read 1");
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
  });

  it("uses one color for the vertical rail and branch end caps", () => {
    const coloredTheme: ThemeLike = {
      fg: (color, text) => `[${color}:${text}]`,
      bold: (text) => text,
    };
    const lines = renderStoryboardScene(
      scene(),
      ["", " thinking"],
      80,
      coloredTheme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    const output = lines.join("\\n");
    expect(output).toContain("[success:◉]");
    expect(output).toContain("[muted:│]");
    expect(output).toContain("[muted:╰─]");
    expect(output).not.toContain("[muted:◉]");
    expect(output).not.toContain("[success:╰─]");
    expect(output).not.toContain("· failed");
  });

  it("keeps a failed tool from coloring the thinking marker as an error", () => {
    const coloredTheme: ThemeLike = {
      fg: (color, text) => `[${color}:${text}]`,
      bold: (text) => text,
    };
    const failed = { ...scene(), state: "failed" as const };
    const output = renderStoryboardScene(
      failed,
      [" thinking"],
      80,
      coloredTheme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    ).join("\\n");

    expect(output).toContain("[success:◉]");
    expect(output).not.toContain("[error:◉]");
    expect(output).not.toContain("· failed");
  });

  it("colors every settled thinking block with the success color", () => {
    const coloredTheme: ThemeLike = {
      fg: (color, text) => `[${color}:${text}]`,
      bold: (text) => text,
    };
    const base = scene();
    const firstTool = base.actionRuns[0]!.rows[0]!;
    const secondTool = { ...firstTool, toolCallId: "read-2", toolRow: "read-2" };
    const ordered = {
      ...base,
      actionRuns: [
        { kind: "read" as const, rows: [firstTool] },
        { kind: "read" as const, rows: [secondTool] },
      ],
      orderedChildren: [
        { type: "assistant" as const, content: { type: "thinking" as const, row: "first", renderedLines: [" first"] } },
        { type: "tool" as const, tool: firstTool },
        { type: "assistant" as const, content: { type: "thinking" as const, row: "second", renderedLines: [" second"] } },
        { type: "tool" as const, tool: secondTool },
      ],
    };
    const output = renderStoryboardScene(
      ordered,
      ["", " first", "", " second"],
      80,
      coloredTheme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    ).join("\\n");
    expect(output).toContain("[success:◉]");
    expect(output).toContain("[success:○]");
  });

  it("colors thinking before a completed final answer as successful", () => {
    const coloredTheme: ThemeLike = {
      fg: (color, text) => `[${color}:${text}]`,
      bold: (text) => text,
    };
    const layout = renderNativeThinkingMarkersLayout(
      ["", " thought", "", " final"],
      [
        { type: "thinking", row: "thinking", renderedLines: [" thought"] },
        { type: "final_answer", row: "final", renderedLines: [" final"] },
      ],
      80,
      coloredTheme,
      "success",
    );
    expect(layout.lines.join("\\n")).toContain("[success:○]");
    expect(layout.lines.join("\\n")).toContain(" final");
  });

  it("marks every separated thinking paragraph while leaving final text native", () => {
    const content = [
      {
        type: "thinking" as const,
        row: "thinking",
        renderedLines: [" first thinking", "", " second thinking"],
      },
      { type: "native" as const, row: "spacer", renderedLines: [""] },
      { type: "final_answer" as const, row: "final", renderedLines: [" final answer"] },
    ];
    const layout = renderNativeThinkingMarkersLayout(
      ["", " first thinking", "", " second thinking", "", " final answer"],
      content,
      80,
      theme,
    );
    const output = layout.lines.join("\\n");
    expect(output).toContain("○ first thinking");
    expect(output).toContain("○ second thinking");
    expect(output).toContain(" final answer");
    expect(output).not.toContain("○ final answer");
    expect(layout.assistantRegions).toHaveLength(1);
  });

  it("uses a terminal content marker when native commentary is the final child", () => {
    const base = scene();
    const tool = base.actionRuns[0]!.rows[0]!;
    const ordered = {
      ...base,
      orderedChildren: [
        {
          type: "assistant" as const,
          content: { type: "thinking" as const, row: "thinking", renderedLines: [" checking"] },
        },
        { type: "tool" as const, tool },
        {
          type: "assistant" as const,
          content: {
            type: "commentary" as const,
            row: "commentary",
            renderedLines: [" closing commentary", " second line"],
          },
        },
      ],
    };
    const lines = renderStoryboardScene(
      ordered,
      ["", " checking", "", " closing commentary", " second line"],
      80,
      theme,
      (group) => ["", ` ${group.kind} ${group.rows.length}`],
    );
    expect(lines.join("\n")).toContain("├─ read 1");
    expect(lines.join("\n")).toContain("╰ closing commentary");
    expect(lines.at(-1)).toContain("second line");
    expect(lines.at(-1)).not.toContain("│");
  });

  it("deducts each structural prefix before rendering native content and groups", () => {
    const widths: number[] = [];
    const lines = renderStoryboardScene(
      scene(),
      [` assistant work${" ".repeat(40)}`],
      80,
      theme,
      (group, width) => {
        widths.push(width);
        return ["", ` ${group.kind} 1 file`, "  ● src/a.ts"];
      },
    );

    expect(widths).toEqual([77]);
    expect(lines.some((line) => line.startsWith(" ◉ assistant work"))).toBe(true);
    expect(lines).toContain(" ╰─ read 1 file");
    expect(lines).toContain("     ● src/a.ts");
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);

    for (const width of [1, 2, 10, 30, 49, 80, 120]) {
      const narrow = renderStoryboardScene(
        scene(),
        [" assistant work"],
        width,
        theme,
        () => ["", " heading", "  row"],
      );
      expect(narrow.length).toBeGreaterThan(0);
      expect(narrow.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  it("uses a quiet note marker for a thinking-only turn", () => {
    const note = {
      ...scene(),
      state: "note" as const,
      actionRuns: [],
      assistant: {
        ...scene().assistant,
        expectedToolCallIds: [],
      },
      orderedChildren: [{
        type: "assistant" as const,
        content: { type: "thinking" as const, row: "thinking", renderedLines: [" reviewing logic"] },
      }],
    };
    const lines = renderStoryboardScene(note, ["", " reviewing logic"], 80, theme, () => [""]);
    expect(lines.join("\n")).toContain("○ reviewing logic");
    expect(lines.join("\n")).not.toContain("note");
    expect(lines.join("\n")).not.toContain("action");
  });

  it("collapses the middle of an overlong continuous thinking block", () => {
    const thinkingLines = [
      " thought 1",
      "",
      " thought 2",
      "",
      " thought 3",
      "",
      " thought 4",
      "",
      " thought 5",
      "",
      " thought 6",
      "",
      " thought 7",
    ];
    const base = scene();
    const note = {
      ...base,
      state: "note" as const,
      actionRuns: [],
      assistant: {
        ...base.assistant,
        expectedToolCallIds: [],
        hasThinking: true,
      },
      orderedChildren: [{
        type: "assistant" as const,
        content: { type: "thinking" as const, row: "thinking", renderedLines: thinkingLines },
      }],
    };
    const lines = renderStoryboardScene(note, ["", ...thinkingLines], 100, theme, () => [""]);
    const output = lines.join("\\n");
    expect(output).toContain("thought 1");
    expect(output).toContain("thought 2");
    expect(output).toContain("↳ 3 thinking steps behind the scenes");
    expect(lines.find((line) => line.includes("behind the scenes"))).toMatch(/^ │ ↳/u);
    expect(output).toContain("thought 6");
    expect(output).toContain("thought 7");
    expect(output).not.toContain("thought 3");
    expect(output).not.toContain("thought 4");
    expect(output).not.toContain("thought 5");
    expect(output.match(/○/gu)).toHaveLength(4);
  });

  it("puts a presentation-only thinking placeholder above a tool-only turn", () => {
    const toolOnly = scene();
    const emptyAssistant = {
      ...toolOnly.assistant,
      renderedAssistantLines: [],
      hasThinking: false,
    };
    const lines = renderStoryboardScene(
      { ...toolOnly, assistant: emptyAssistant },
      [],
      100,
      theme,
      () => ["", " Write 1 file", "  ● a.txt"],
    );
    const output = lines.join("\n");
    expect(output).toContain("◉ Thinking...");
    expect(output).toContain("╰─ Write 1 file");
    expect(output).not.toContain("Tool step");
  });

  it("reserves width for the widest configured structural prefixes", () => {
    const settings = normalizePresentationSettings({
      "pi-storyboard": {
        symbols: {
          thinkingRoot: "ROOT",
          thinkingStep: "s",
          rail: "RAIL",
          branch: "B",
          lastBranch: "LAST",
        },
      },
    });
    const base = scene();
    const secondRun = {
      ...base.actionRuns[0]!,
      rows: [...base.actionRuns[0]!.rows],
    };
    const ordered = {
      ...base,
      actionRuns: [base.actionRuns[0]!, secondRun],
      orderedChildren: [
        {
          type: "assistant" as const,
          content: { type: "thinking" as const, row: "thinking", renderedLines: [" thinking"] },
        },
        { type: "tool" as const, tool: base.actionRuns[0]!.rows[0]! },
        { type: "tool" as const, tool: secondRun.rows[0]! },
      ],
    };

    for (const width of [1, 4, 10, 20, 80]) {
      const lines = renderStoryboardScene(
        ordered,
        ["", " thinking"],
        width,
        theme,
        () => ["", " heading", " continuation"],
        settings,
      );
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }

    const lines = renderStoryboardScene(
      ordered,
      ["", " thinking"],
      80,
      theme,
      () => ["", " heading", " continuation"],
      settings,
    );
    expect(lines.some((line) => line.includes("RAIL"))).toBe(true);
    expect(lines.some((line) => line.includes("LAST"))).toBe(true);
  });

  it("uses configured symbols and colors without changing scene ownership", () => {
    const settings = normalizePresentationSettings({
      "pi-storyboard": {
        symbols: {
          thinkingRoot: "R",
          thinkingStep: "s",
          thinkingPlaceholder: "Waiting",
          hiddenThinking: "h",
          rail: "!",
          branch: "=>",
          lastBranch: "END",
          toolDots: { read: "r" },
        },
        colors: {
          status: { complete: "warning" },
          thinking: { settled: "accent" },
          structure: "syntaxString",
        },
      },
    });
    const coloredTheme: ThemeLike = {
      fg: (color, text) => `[${color}:${text}]`,
      bold: (text) => text,
    };
    const base = scene();
    const secondRun = {
      ...base.actionRuns[0]!,
      rows: [...base.actionRuns[0]!.rows],
    };
    const output = renderStoryboardScene(
      { ...base, actionRuns: [base.actionRuns[0]!, secondRun] },
      ["", " thinking"],
      80,
      coloredTheme,
      (group, groupWidth, groupTheme, passedSettings) => renderToolGroup(
        group,
        groupWidth,
        groupTheme,
        passedSettings ?? settings,
      ),
      settings,
    ).join("\n");

    expect(output).toContain("[accent:R]");
    expect(output).toContain("[warning:  r ]");
    expect(output).toContain("[syntaxString:!]");
    expect(output).toContain("[syntaxString:=>]");
    expect(output).toContain("[syntaxString:END]");
    expect(output).not.toContain("[success:R]");
  });
});
