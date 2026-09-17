import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { TranscriptReplay } from "./transcript-replay.ts";
import { renderToolGroup, type GroupSnapshot, type ThemeLike } from "./renderer.ts";
import { normalizePresentationSettings } from "./presentation-settings.ts";
import {
  renderStoryboardScene,
  renderStoryboardWorkSpanLayout,
  storyboardAssistantWidth,
} from "./storyboard-renderer.ts";
import {
  buildEmptyThinkingContinuation,
  buildWorkSpan,
  type StoryboardActionRun,
  type StoryboardOrderedChild,
  type StoryboardScene,
  type StoryboardToolSnapshot,
} from "./storyboard.ts";
import {
  Box,
  CancellableLoader,
  Container,
  Editor,
  HStack,
  Image,
  Input,
  Key,
  Loader,
  Markdown,
  MouseRegion,
  ScrollView,
  SelectList,
  SettingsList,
  Spacer,
  Text,
  TruncatedText,
  VStack,
  isFocusable,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type EditorTheme,
  type KeyId,
  type MarkdownTheme,
  type SelectListTheme,
  type SettingsListTheme,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

type PreviewComponent = Component & {
  dispose?(): void;
};

type PreviewContext = {
  tui: TUI;
  theme: Theme;
  cwd: string;
  requestRender(): void;
};

type PreviewDefinition = {
  name: string;
  description: string;
  create(context: PreviewContext): PreviewComponent;
};

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const SAMPLE_IMAGE =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR42mNk+M/wHwAFAgI/" +
  "QwMDAwMAAAADAAEAAeE7AAAAAElFTkSuQmCC";

const COLOR_NAMES: readonly ThemeColor[] = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "scrollbarTrack",
  "scrollbarThumb",
  "searchMatchText",
  "userMessageText",
  "customMessageText",
  "customMessageLabel",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "thinkingMax",
  "bashMode",
];

function selectListTheme(theme: Theme): SelectListTheme {
  return {
    selectedPrefix: (text) => theme.fg("accent", text),
    selectedText: (text) => theme.fg("accent", text),
    description: (text) => theme.fg("muted", text),
    scrollInfo: (text) => theme.fg("dim", text),
    noMatch: (text) => theme.fg("warning", text),
  };
}

function settingsListTheme(theme: Theme): SettingsListTheme {
  return {
    label: (text, selected) => (selected ? theme.fg("accent", text) : text),
    value: (text, selected) => (selected ? theme.fg("accent", text) : theme.fg("muted", text)),
    description: (text) => theme.fg("dim", text),
    cursor: theme.fg("accent", "→ "),
    hint: (text) => theme.fg("dim", text),
  };
}

function editorTheme(theme: Theme): EditorTheme {
  return {
    borderColor: (text) => theme.fg("borderMuted", text),
    selectList: selectListTheme(theme),
  };
}

function markdownTheme(theme: Theme): MarkdownTheme {
  return {
    heading: (text) => theme.fg("mdHeading", text),
    link: (text) => theme.fg("mdLink", text),
    linkUrl: (text) => theme.fg("mdLinkUrl", text),
    code: (text) => theme.fg("mdCode", text),
    codeBlock: (text) => theme.fg("mdCodeBlock", text),
    codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text),
    quote: (text) => theme.fg("mdQuote", text),
    quoteBorder: (text) => theme.fg("mdQuoteBorder", text),
    hr: (text) => theme.fg("mdHr", text),
    listBullet: (text) => theme.fg("mdListBullet", text),
    bold: (text) => theme.bold(text),
    italic: (text) => theme.italic(text),
    strikethrough: (text) => theme.strikethrough(text),
    underline: (text) => theme.underline(text),
  };
}

function panelText(theme: Theme, label: string, value: string): string {
  return `${theme.fg("accent", label)} ${theme.fg("muted", value)}`;
}

function toolGroupTheme(theme: Theme): ThemeLike {
  return {
    fg: (color, text) => theme.fg(color, text),
    bold: (text) => theme.bold(text),
    italic: (text) => theme.italic(text),
  };
}

/** Preview every foreground theme token with the same dot used by tool rows. */
class ColorPalette implements Component {
  constructor(private readonly theme: Theme) {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    const columns = safeWidth >= 66 ? 3 : safeWidth >= 44 ? 2 : 1;
    const columnWidth = Math.max(1, Math.floor(safeWidth / columns));
    const cells = COLOR_NAMES.map(
      (color) => `${this.theme.fg(color, "●")} ${this.theme.fg("muted", color)}`,
    );
    const lines: string[] = [];

    for (let index = 0; index < cells.length; index += columns) {
      const row = cells.slice(index, index + columns).map((cell, column) => {
        const fitted = truncateToWidth(cell, columnWidth, "");
        return column === columns - 1 ? fitted : padRight(fitted, columnWidth);
      });
      lines.push(row.join(""));
    }
    return lines;
  }

  invalidate(): void {}
}

const SAMPLE_TOOL_GROUPS: readonly GroupSnapshot[] = [
  {
    kind: "read",
    rows: [
      {
        toolName: "read",
        args: {
          path: "/Users/fong/Documents/FHY/pi-storyboard/src/components/very-long-file-name.ts",
        },
        result: { content: [], isError: false },
        isPartial: false,
        expanded: false,
      },
      {
        toolName: "read",
        args: { path: "src/renderer.ts", offset: 240, limit: 80 },
        result: { content: [], isError: false },
        isPartial: false,
        expanded: false,
      },
      {
        toolName: "read",
        args: { path: "src/tui-preview.ts" },
        isPartial: true,
        expanded: false,
      },
    ],
  },
  {
    kind: "search",
    rows: [
      {
        toolName: "grep",
        args: { pattern: "renderToolGroup", path: "src/" },
        result: { content: [], isError: false },
        isPartial: false,
        expanded: false,
      },
      {
        toolName: "find",
        args: { pattern: "*.test.ts", path: "test/" },
        isPartial: true,
        expanded: false,
      },
    ],
  },
  {
    kind: "list",
    rows: [
      {
        toolName: "ls",
        args: { path: "src/" },
        result: { content: [], isError: false },
        isPartial: false,
        expanded: false,
      },
      {
        toolName: "ls",
        args: { path: "test/" },
        result: { content: [], isError: false },
        isPartial: false,
        expanded: false,
      },
    ],
  },
  {
    kind: "write",
    rows: [
      {
        toolName: "write",
        args: { path: "src/index.ts", content: "hidden file contents" },
        result: { content: [], isError: false },
        isPartial: false,
        expanded: false,
      },
    ],
  },
  {
    kind: "edit",
    rows: [
      {
        toolName: "edit",
        args: { path: "src/renderer.ts", replacementCount: 2 },
        result: { content: [], isError: false },
        isPartial: false,
        expanded: false,
      },
      {
        toolName: "edit",
        args: { path: "src/pi-adapter.ts", replacementCount: 1 },
        result: { content: [], isError: false },
        isPartial: false,
        expanded: false,
      },
      {
        toolName: "edit",
        args: { path: "README.md" },
        isPartial: true,
        expanded: false,
      },
    ],
  },
  {
    kind: "command",
    rows: [
      {
        toolName: "bash",
        args: { command: "npm test" },
        result: { content: [], isError: false },
        isPartial: false,
        expanded: false,
      },
      {
        toolName: "powershell",
        args: { command: "Get-ChildItem", cwd: "src" },
        isPartial: true,
        expanded: false,
      },
      {
        toolName: "bash",
        args: { command: "npm run check" },
        result: { content: [], isError: true },
        errorSummary: "Command exited with code 1",
        isPartial: false,
        expanded: false,
      },
    ],
  },
  {
    kind: "tool",
    rows: [
      {
        toolName: "custom-tool",
        args: { target: "src" },
        result: { content: [], isError: false },
        isPartial: false,
        expanded: false,
      },
      {
        toolName: "mcp.lookup",
        args: { id: 42 },
        result: { content: [], isError: false },
        isPartial: false,
        expanded: false,
      },
    ],
  },
];

class ToolGroupsSample implements Component {
  constructor(private readonly theme: Theme) {}

  render(width: number): string[] {
    const rendered: string[] = [];
    const theme = toolGroupTheme(this.theme);
    for (const group of SAMPLE_TOOL_GROUPS) {
      // renderToolGroup includes Pi's native one-line top spacer for each
      // tool block, so separate groups retain the same rhythm as real rows.
      rendered.push(...renderToolGroup(group, width, theme));
    }
    return rendered;
  }

  invalidate(): void {}
}

const SETTINGS_PREVIEW_GROUP: GroupSnapshot = {
  kind: "read",
  rows: [{
    toolName: "read",
    args: { path: "/Users/fong/Documents/FHY/pi-storyboard/src/very-long-file-name.ts" },
    result: { content: [], isError: false },
    isPartial: false,
    expanded: false,
  }],
};

const SETTINGS_PREVIEW_SETTINGS = normalizePresentationSettings({
  "pi-storyboard": {
    trimming: { fileNames: false, commands: true },
    symbols: {
      toolDot: "•",
      toolDots: { read: "R" },
      thinkingRoot: "◆",
      thinkingStep: "·",
      thinkingPlaceholder: "Waiting...",
      hiddenThinking: "…",
      rail: "┃",
      branch: "╞═",
      lastBranch: "╘═",
    },
    colors: {
      status: { complete: "accent" },
      thinking: { settled: "warning" },
      structure: "syntaxString",
    },
  },
});

/** Preview the settings-controlled presentation without touching Pi settings. */
class PresentationSettingsSample implements Component {
  constructor(private readonly theme: Theme) {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    const groupTheme = toolGroupTheme(this.theme);
    const defaults = normalizePresentationSettings(undefined);
    const sceneTool = {
      toolRow: "settings-preview-tool",
      toolCallId: "settings-preview-tool",
      kind: "read" as const,
      snapshot: SETTINGS_PREVIEW_GROUP.rows[0]!,
    };
    const scene: StoryboardScene = {
      type: "scene",
      assistant: {
        assistantRow: "settings-preview-assistant",
        renderedAssistantLines: ["", " Inspecting settings"],
        expectedToolCallIds: [sceneTool.toolCallId],
        stopReason: "toolUse",
        isStreaming: false,
        hasThinking: true,
        hasText: false,
        hasFinalAnswer: false,
        hasUnknownText: false,
      },
      actionRuns: [{ kind: "read", rows: [sceneTool] }],
      orderedChildren: [
        {
          type: "assistant",
          content: {
            type: "thinking",
            row: "settings-preview-thinking",
            renderedLines: [" Inspecting settings"],
          },
        },
        { type: "tool", tool: sceneTool },
      ],
      state: "complete",
    };
    const lines = [
      this.theme.fg("accent", "Built-in defaults"),
      this.theme.fg("dim", "Middle-trimmed paths and the original storyboard grammar."),
      ...renderToolGroup(SETTINGS_PREVIEW_GROUP, safeWidth, groupTheme, defaults),
      "",
      this.theme.fg("accent", "Configured example"),
      this.theme.fg("dim", "End-trimmed paths, per-kind dots, custom symbols, and theme tokens."),
      ...renderStoryboardScene(
        scene,
        scene.assistant.renderedAssistantLines,
        safeWidth,
        groupTheme,
        (group, groupWidth, theme, settings) => renderToolGroup(
          group,
          groupWidth,
          theme,
          settings ?? SETTINGS_PREVIEW_SETTINGS,
        ),
        SETTINGS_PREVIEW_SETTINGS,
      ),
    ];
    return lines.map((line) => truncateToWidth(line, safeWidth, ""));
  }

  invalidate(): void {}
}

type StoryboardPreviewItem =
  | { type: "group"; group: GroupSnapshot }
  | { type: "thinking"; text: string }
  | { type: "commentary"; text: string };

type StoryboardPreviewContent = {
  /** Native thinking content used as the visual turn-block header. */
  title?: string;
  state: "complete" | "running" | "failed" | "note";
  groups: readonly GroupSnapshot[];
  /** Optional exact source-order sample following the native header. */
  items?: readonly StoryboardPreviewItem[];
  detail?: string;
};

type StoryboardPreviewScene = StoryboardPreviewContent & {
  /** A settled empty-thinking scene rendered under this scene's root. */
  continuation?: StoryboardPreviewContent;
};

const STORYBOARD_SCENES: readonly StoryboardPreviewScene[] = [
  {
    title: "Refining row layout logic",
    state: "failed",
    detail: "one assistant response and its tool batch",
    groups: [
      {
        kind: "read",
        rows: SAMPLE_TOOL_GROUPS[0]!.rows.slice(0, 2),
      },
      {
        kind: "edit",
        rows: SAMPLE_TOOL_GROUPS[4]!.rows.slice(0, 1),
      },
      {
        kind: "command",
        rows: [SAMPLE_TOOL_GROUPS[5]!.rows[0]!, SAMPLE_TOOL_GROUPS[5]!.rows[2]!],
      },
    ],
    items: [
      {
        type: "group",
        group: {
          kind: "read",
          rows: SAMPLE_TOOL_GROUPS[0]!.rows.slice(0, 2),
        },
      },
      {
        type: "commentary",
        text: "The native results confirm **commentary can contain Markdown** and remain in source order.",
      },
      { type: "thinking", text: "Confirming the separator after the first read" },
      {
        type: "group",
        group: {
          kind: "edit",
          rows: SAMPLE_TOOL_GROUPS[4]!.rows.slice(0, 1),
        },
      },
      {
        type: "group",
        group: {
          kind: "command",
          rows: [SAMPLE_TOOL_GROUPS[5]!.rows[0]!, SAMPLE_TOOL_GROUPS[5]!.rows[2]!],
        },
      },
    ],
  },
  {
    title: "Planning handler with effect for default config",
    state: "complete",
    detail: "validated commentary followed by an orphan tool run",
    groups: [],
    items: [
      {
        type: "commentary",
        text: "The default `shipping_location` value is now populated on enable.",
      },
      {
        type: "group",
        group: {
          kind: "command",
          rows: [
            {
              toolName: "bash",
              args: { command: "npm test" },
              result: { content: [], isError: false },
              isPartial: false,
              expanded: false,
            },
            {
              toolName: "bash",
              args: { command: "npm run typecheck" },
              result: { content: [], isError: false },
              isPartial: false,
              expanded: false,
            },
            {
              toolName: "bash",
              args: { command: "npx eslint ..." },
              result: { content: [], isError: false },
              isPartial: false,
              expanded: false,
            },
          ],
        },
      },
    ],
  },
  {
    title: "Reviewing atomic handling logic",
    state: "note",
    detail: "thinking-only assistant response · no tool calls",
    groups: [],
  },
  {
    state: "note",
    detail: "long continuous thinking · first two + last two visible",
    groups: [],
    items: [{
      type: "thinking",
      text: [
        "Thinking paragraph 1",
        "Thinking paragraph 2",
        "Thinking paragraph 3",
        "Thinking paragraph 4",
        "Thinking paragraph 5",
        "Thinking paragraph 6",
        "Thinking paragraph 7",
      ].join("\n\n"),
    }],
  },
  {
    title: "Verifying errorDetail line changes",
    state: "running",
    detail: "assistant message and tools are still streaming",
    groups: [
      {
        kind: "read",
        rows: [
          {
            toolName: "read",
            args: { path: "src/renderer.ts", offset: 458, limit: 46 },
            isPartial: true,
            expanded: false,
          },
        ],
      },
      {
        kind: "edit",
        rows: [
          {
            toolName: "edit",
            args: { path: "README.md" },
            isPartial: true,
            expanded: false,
          },
        ],
      },
      {
        kind: "command",
        rows: [
          {
            toolName: "bash",
            args: { command: "npm run check" },
            isPartial: true,
            expanded: false,
          },
        ],
      },
    ],
  },
  {
    title: "Inspecting search strategy",
    state: "complete",
    detail: "one response can contain different semantic groups",
    groups: [SAMPLE_TOOL_GROUPS[1]!, SAMPLE_TOOL_GROUPS[2]!],
  },
  {
    state: "complete",
    detail: "tool-only assistant response · presentation-only Thinking... placeholder",
    groups: [
      {
        kind: "write",
        rows: SAMPLE_TOOL_GROUPS[3]!.rows,
      },
      {
        kind: "command",
        rows: [SAMPLE_TOOL_GROUPS[5]!.rows[0]!],
      },
    ],
  },
  {
    title: "Locating registerTool definitions",
    state: "complete",
    detail: "visible-thinking root",
    groups: [{ kind: "command", rows: [SAMPLE_TOOL_GROUPS[5]!.rows[0]!] }],
    continuation: {
      state: "complete",
      detail: "later settled turn · empty/absent thinking continues under the previous root",
      groups: [{ kind: "read", rows: [SAMPLE_TOOL_GROUPS[0]!.rows[1]!] }],
    },
  },
];

function storyFit(line: string, width: number): string {
  return truncateToWidth(line, Math.max(1, Math.floor(width)), "");
}

/**
 * Static turn-storyboard preview. It uses fixed snapshots only and delegates
 * to the production renderer so the branch and end-cap grammar cannot drift.
 */
class TurnStoryboardSample implements Component {
  private scrollOffset = 0;

  constructor(
    private readonly theme: Theme,
    private readonly tui: TUI,
  ) {}

  private previewScene(scene: StoryboardPreviewScene, width: number): StoryboardScene {
    const assistantWidth = storyboardAssistantWidth(width);
    const orderedChildren: StoryboardOrderedChild[] = [];
    const actionRuns: StoryboardActionRun[] = [];
    let toolIndex = 0;

    if (scene.title !== undefined) {
      const nativeThinking = new Text(
        this.theme.italic(this.theme.fg("thinkingText", scene.title)),
        1,
        0,
      );
      orderedChildren.push({
        type: "assistant",
        content: {
          type: "thinking",
          row: nativeThinking,
          renderedLines: nativeThinking.render(assistantWidth),
        },
      });
    }

    const items = scene.items ?? scene.groups.map((group) => ({ type: "group" as const, group }));
    for (const item of items) {
      if (item.type === "thinking") {
        const nativeThinking = new Text(
          this.theme.italic(this.theme.fg("thinkingText", item.text)),
          1,
          0,
        );
        orderedChildren.push({
          type: "assistant",
          content: {
            type: "thinking",
            row: nativeThinking,
            renderedLines: nativeThinking.render(assistantWidth),
          },
        });
        continue;
      }
      if (item.type === "commentary") {
        const markdown = new Markdown(item.text, 1, 0, markdownTheme(this.theme));
        orderedChildren.push({
          type: "assistant",
          content: {
            type: "commentary",
            row: markdown,
            renderedLines: markdown.render(assistantWidth),
          },
        });
        continue;
      }

      const rows: StoryboardToolSnapshot[] = item.group.rows.map((snapshot) => {
        const toolCallId = `preview-${toolIndex++}`;
        return {
          toolRow: toolCallId,
          toolCallId,
          kind: item.group.kind,
          snapshot,
        };
      });
      actionRuns.push({ kind: item.group.kind, rows });
      orderedChildren.push(...rows.map((tool) => ({ type: "tool" as const, tool })));
    }

    const allTools = actionRuns.flatMap((run) => run.rows);
    return {
      type: "scene",
      assistant: {
        assistantRow: scene,
        renderedAssistantLines: [],
        expectedToolCallIds: allTools.map((tool) => tool.toolCallId),
        stopReason: scene.state === "running" ? "pending" : scene.state === "failed" ? "error" : "toolUse",
        isStreaming: scene.state === "running",
        hasThinking: scene.title !== undefined,
        hasText: items.some((item) => item.type === "commentary"),
        hasFinalAnswer: false,
        hasUnknownText: false,
      },
      actionRuns,
      orderedChildren,
      state: scene.state,
    };
  }

  private renderAll(width: number): string[] {
    const safeWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
    const indent = safeWidth >= 50 ? " " : "";
    const rendered: string[] = [];
    const groupTheme = toolGroupTheme(this.theme);

    rendered.push(storyFit(
      `${indent}${this.theme.fg("accent", "◉")}/${this.theme.fg("muted", "○")} ${this.theme.fg("muted", "native thinking starts a visual Pi turn block; work chapters may continue (tools/note)")}`,
      safeWidth,
    ));
    rendered.push(storyFit(
      `${indent}${this.theme.fg("muted", "├─")} ${this.theme.fg("dim", "more source-ordered content or action children follow")}`,
      safeWidth,
    ));
    rendered.push(storyFit(
      `${indent}${this.theme.fg("muted", "╰─")} ${this.theme.fg("dim", "final child closes the scene/chapter")}`,
      safeWidth,
    ));
    rendered.push(storyFit(
      `${indent}${this.theme.fg("dim", "boundary")} ${this.theme.fg("muted", "= no persisted master record · scenes retain one response + matched tools")}`,
      safeWidth,
    ));
    rendered.push(storyFit(
      `${indent}${this.theme.fg("accent", "expanded")} ${this.theme.fg("dim", "→ native Pi rows · full output · diffs · diagnostics")}`,
      safeWidth,
    ));

    for (const preview of STORYBOARD_SCENES) {
      const firstScene = this.previewScene(preview, safeWidth);
      if (preview.continuation !== undefined) {
        const continuationScene = this.previewScene(preview.continuation, safeWidth);
        const span = buildEmptyThinkingContinuation([firstScene, continuationScene]);
        if (span !== undefined) {
          rendered.push(...renderStoryboardWorkSpanLayout(
            span,
            safeWidth,
            toolGroupTheme(this.theme),
            (group, groupWidth, theme) => renderToolGroup(group, groupWidth, theme),
          ).lines);
          continue;
        }
      }
      const commentarySpan = firstScene.assistant.hasText
        ? buildWorkSpan([firstScene])
        : undefined;
      if (commentarySpan !== undefined) {
        rendered.push(...renderStoryboardWorkSpanLayout(
          commentarySpan,
          safeWidth,
          toolGroupTheme(this.theme),
          (group, groupWidth, theme) => renderToolGroup(group, groupWidth, theme),
        ).lines);
        continue;
      }
      rendered.push(...renderStoryboardScene(
        firstScene,
        [""],
        safeWidth,
        toolGroupTheme(this.theme),
        (group, groupWidth, theme) => renderToolGroup(group, groupWidth, theme),
      ));
    }

    rendered.push("");
    rendered.push(storyFit(
      `${indent}${this.theme.fg("syntaxKeyword", "compact")} ${this.theme.fg("muted", "Collapsed running edit → pending path row; expand for native preview")}`,
      safeWidth,
    ));

    const nativeCases = [
      "Expanded tool output → complete native Pi rows",
      "Final answer → complete native assistant Markdown",
      "Unknown text phase → complete native fallback",
    ];
    for (const nativeCase of nativeCases) {
      rendered.push("");
      rendered.push(storyFit(
        `${indent}${this.theme.fg("dim", "native")} ${this.theme.fg("muted", nativeCase)}`,
        safeWidth,
      ));
    }

    return rendered;
  }

  handleInput(data: string): void {
    const step = Math.max(1, (this.tui.terminal.rows || 24) - 8);
    if (matchesKey(data, Key.up)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
    } else if (matchesKey(data, Key.down)) {
      this.scrollOffset += 1;
    } else if (matchesKey(data, Key.pageUp)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - step);
    } else if (matchesKey(data, Key.pageDown)) {
      this.scrollOffset += step;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    const allLines = this.renderAll(safeWidth);
    const viewportRows = Math.max(4, (this.tui.terminal.rows || 24) - 6);
    const showScroll = allLines.length > viewportRows;
    const contentRows = Math.max(1, viewportRows - (showScroll ? 1 : 0));
    const maxOffset = Math.max(0, allLines.length - contentRows);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
    const visible = allLines.slice(this.scrollOffset, this.scrollOffset + contentRows);

    if (showScroll) {
      const end = Math.min(allLines.length, this.scrollOffset + contentRows);
      visible.push(storyFit(
        this.theme.fg("dim", `↕ scroll ${this.scrollOffset + 1}-${end}/${allLines.length}`),
        safeWidth,
      ));
    }
    return visible;
  }

  invalidate(): void {}
}

function createDefinitions(): PreviewDefinition[] {
  return [
    {
      name: "ToolGroups",
      description: "Current grouped non-edit tool summaries",
      create: ({ theme }) => new ToolGroupsSample(theme),
    },
    {
      name: "Turn storyboard",
      description: "Thinking-led turn blocks with explicit branch endings",
      create: ({ theme, tui }) => new TurnStoryboardSample(theme, tui),
    },
    {
      name: "Colors",
      description: "All Pi theme foreground colors using ●",
      create: ({ theme }) => new ColorPalette(theme),
    },
    {
      name: "Storyboard settings",
      description: "Default and custom trimming, symbols, dots, and colors",
      create: ({ theme }) => new PresentationSettingsSample(theme),
    },
    {
      name: "Text",
      description: "Wrapped multi-line text",
      create: ({ theme }) =>
        new Text(
          `${theme.bold("Text component")}\nWraps text across lines and supports ANSI styling.\n${theme.fg("muted", "Padding can be configured.")}`,
          1,
          0,
        ),
    },
    {
      name: "TruncatedText",
      description: "Single-line width truncation",
      create: ({ theme }) =>
        new TruncatedText(
          theme.fg("toolTitle", "TruncatedText keeps one line and adds an ellipsis when space runs out."),
          1,
          0,
        ),
    },
    {
      name: "Spacer",
      description: "Empty vertical space",
      create: ({ theme }) => {
        const container = new Container();
        container.addChild(new Text(theme.fg("muted", "Above the spacer"), 0, 0));
        container.addChild(new Spacer(2));
        container.addChild(new Text(theme.fg("muted", "Below the spacer"), 0, 0));
        return container;
      },
    },
    {
      name: "Box",
      description: "Padding and background",
      create: ({ theme }) => {
        const box = new Box(2, 1, (text) => theme.bg("customMessageBg", text));
        box.addChild(new Text(`${theme.bold("Box")}\nBackground and padding`, 0, 0));
        return box;
      },
    },
    {
      name: "Container",
      description: "Vertical child composition",
      create: ({ theme }) => {
        const container = new Container();
        container.addChild(new Text(theme.fg("accent", "First child"), 0, 0));
        container.addChild(new Text(theme.fg("muted", "Second child"), 2, 0));
        container.addChild(new Text(theme.fg("success", "Third child"), 4, 0));
        return container;
      },
    },
    {
      name: "VStack",
      description: "Vertical flex layout with gaps",
      create: ({ theme }) =>
        new VStack(
          [
            new Text(theme.fg("accent", "VStack item A"), 0, 0),
            new Text(theme.fg("muted", "VStack item B"), 0, 0),
            new Text(theme.fg("success", "VStack item C"), 0, 0),
          ],
          { gap: 1 },
        ),
    },
    {
      name: "HStack",
      description: "Horizontal flex layout",
      create: ({ theme }) =>
        new HStack(
          [
            new Box(1, 0, (text) => theme.bg("toolPendingBg", text)),
            new Box(1, 0, (text) => theme.bg("toolSuccessBg", text)),
            new Box(1, 0, (text) => theme.bg("toolErrorBg", text)),
          ].map((box, index) => {
            box.addChild(new Text(theme.bold(`Column ${index + 1}`), 0, 0));
            return box;
          }),
          { gap: 1, align: "center" },
        ),
    },
    {
      name: "Markdown",
      description: "Markdown formatting and wrapping",
      create: ({ theme }) =>
        new Markdown(
          "# Markdown\n\nSupports **bold**, *italic*, `inline code`, links, lists, and fenced code.\n\n- item one\n- item two\n\n> A quoted line",
          0,
          0,
          markdownTheme(theme),
        ),
    },
    {
      name: "SelectList",
      description: "Keyboard and mouse selection",
      create: ({ theme }) => {
        const list = new SelectList(
          [
            { value: "one", label: "One", description: "First option" },
            { value: "two", label: "Two", description: "Second option" },
            { value: "three", label: "Three", description: "Third option" },
            { value: "four", label: "Four", description: "Fourth option" },
          ],
          4,
          selectListTheme(theme),
        );
        list.onSelect = () => undefined;
        return list;
      },
    },
    {
      name: "SettingsList",
      description: "Editable settings and values",
      create: ({ theme }) =>
        new SettingsList(
          [
            { id: "theme", label: "Theme", currentValue: "dark", values: ["dark", "light"] },
            { id: "layout", label: "Layout", currentValue: "compact", values: ["compact", "wide"] },
            { id: "status", label: "Status", currentValue: "enabled", values: ["enabled", "disabled"] },
          ],
          5,
          settingsListTheme(theme),
          () => undefined,
          () => undefined,
        ),
    },
    {
      name: "Input",
      description: "Single-line editable input",
      create: ({ theme }) =>
        new Input({
          prompt: theme.fg("accent", "› "),
          placeholder: "Type here and try cursor movement",
          placeholderStyle: (text) => theme.fg("dim", text),
        }),
    },
    {
      name: "Editor",
      description: "Multi-line editable input",
      create: ({ tui, theme }) => {
        const editor = new Editor(tui, editorTheme(theme), { paddingX: 1 });
        editor.setText("Edit this\nmultiple-line\nvalue");
        return editor;
      },
    },
    {
      name: "Loader",
      description: "Progress indicator",
      create: ({ tui, theme }) =>
        new Loader(
          tui,
          (text) => theme.fg("accent", text),
          (text) => theme.fg("muted", text),
          "Loader is animating",
          { frames: ["◈"] },
        ),
    },
    {
      name: "CancellableLoader",
      description: "Loader with Escape cancellation",
      create: ({ tui, theme }) => {
        const loader = new CancellableLoader(
          tui,
          (text) => theme.fg("warning", text),
          (text) => theme.fg("muted", text),
          "Press Escape to close this preview",
          { frames: ["◈"] },
        );
        loader.onAbort = () => undefined;
        return loader;
      },
    },
    {
      name: "ScrollView",
      description: "Scrollable vertical content",
      create: ({ theme }) => {
        const content = new VStack(
          Array.from({ length: 14 }, (_, index) =>
            new Text(panelText(theme, `${String(index + 1).padStart(2, "0")}.`, "Scrollable content"), 0, 0),
          ),
          { gap: 1 },
        );
        return new ScrollView(content, {
          scrollbar: "always",
          scrollbarTrackStyle: (text) => theme.fg("scrollbarTrack", text),
          scrollbarThumbStyle: (text) => theme.fg("scrollbarThumb", text),
        });
      },
    },
    {
      name: "MouseRegion",
      description: "Mouse handling wrapper",
      create: ({ theme, requestRender }) => {
        const text = new Text(theme.fg("accent", "Click this row to exercise MouseRegion"), 1, 0);
        return new MouseRegion(text, (event) => {
          if (event.type === "click") {
            text.setText(theme.fg("success", "MouseRegion received a click ●"));
            requestRender();
          }
          return { handled: true, render: true };
        });
      },
    },
    {
      name: "Image",
      description: "Terminal image with fallback",
      create: ({ theme }) =>
        new Image(SAMPLE_IMAGE, "image/png", {
          fallbackColor: (text) => theme.fg("muted", text),
        }, { maxWidthCells: 12, maxHeightCells: 6 }),
    },
    {
      name: "Transcript replay",
      description: "Session tail using real Pi assistant/tool components",
      create: ({ tui, theme, cwd }) => new TranscriptReplay(tui, cwd, theme),
    },
  ];
}

function padRight(line: string, width: number): string {
  const remaining = Math.max(0, width - visibleWidth(line));
  return `${line}${" ".repeat(remaining)}`;
}

function fit(line: string, width: number): string {
  return truncateToWidth(line, Math.max(1, width), "");
}

function isKey(data: string, key: KeyId): boolean {
  return matchesKey(data, key);
}

export class TuiPreview implements PreviewComponent {
  private readonly definitions = createDefinitions();
  private readonly selector: SelectList;
  private selectedIndex = 0;
  private current: PreviewComponent;
  private panel: "list" | "preview" = "list";
  private _focused = false;
  private disposed = false;
  private sidebarBounds?: Bounds;
  private previewBounds?: Bounds;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: () => void,
    private readonly cwd = process.cwd(),
  ) {
    this.selector = new SelectList(
      this.definitions.map(({ name, description }) => ({ value: name, label: name, description })),
      9,
      selectListTheme(theme),
    );
    this.selector.onSelectionChange = () => this.syncSelectedComponent();
    this.selector.onSelect = () => this.focusPreview();
    this.current = this.createCurrent();
    this.updateInnerFocus();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.updateInnerFocus();
  }

  private createCurrent(): PreviewComponent {
    const definition = this.definitions[this.selectedIndex];
    if (!definition) throw new Error("TUI preview selection is out of range");
    return definition.create({
      tui: this.tui,
      theme: this.theme,
      cwd: this.cwd,
      requestRender: () => this.tui.requestRender(),
    });
  }

  private disposeCurrent(): void {
    this.current.dispose?.();
    const stoppable = this.current as PreviewComponent & { stop?: () => void };
    stoppable.stop?.();
  }

  private syncSelectedComponent(): void {
    const item = this.selector.getSelectedItem();
    const nextIndex = item ? this.definitions.findIndex(({ name }) => name === item.value) : -1;
    if (nextIndex < 0 || nextIndex === this.selectedIndex) return;

    this.disposeCurrent();
    this.selectedIndex = nextIndex;
    this.current = this.createCurrent();
    this.updateInnerFocus();
    this.tui.requestRender();
  }

  private updateInnerFocus(): void {
    if (isFocusable(this.current)) this.current.focused = this._focused && this.panel === "preview";
  }

  private focusList(): void {
    this.panel = "list";
    this.updateInnerFocus();
    this.tui.requestRender();
  }

  private focusPreview(): void {
    this.panel = "preview";
    this.updateInnerFocus();
    this.tui.requestRender();
  }

  private close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeCurrent();
    this.done();
  }

  private handlePreviewInput(data: string): void {
    if (this.current instanceof ScrollView && isKey(data, Key.up)) {
      this.current.scrollBy(-1);
      this.tui.requestRender();
      return;
    }
    if (this.current instanceof ScrollView && isKey(data, Key.down)) {
      this.current.scrollBy(1);
      this.tui.requestRender();
      return;
    }
    this.current.handleInput?.(data);
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (isKey(data, Key.escape)) {
      this.close();
      return;
    }

    if (this.panel === "list") {
      if (isKey(data, Key.tab) || isKey(data, Key.right) || isKey(data, Key.enter)) {
        this.focusPreview();
        return;
      }
      this.selector.handleInput(data);
      this.syncSelectedComponent();
      return;
    }

    if (isKey(data, Key.tab) || isKey(data, Key.left)) {
      this.focusList();
      return;
    }
    this.handlePreviewInput(data);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const bounds = this.panel === "list" ? this.sidebarBounds : this.previewBounds;
    if (!bounds || event.x < bounds.x || event.x >= bounds.x + bounds.width || event.y < bounds.y || event.y >= bounds.y + bounds.height) {
      return undefined;
    }

    const child = this.panel === "list" ? this.selector : this.current;
    const result = child.handleMouse?.({
      ...event,
      x: event.x - bounds.x,
      y: event.y - bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
    if (this.panel === "list") this.syncSelectedComponent();
    if (result?.focus) {
      this.panel = this.panel === "list" ? "list" : "preview";
      this.updateInnerFocus();
    }
    return result ?? { handled: true, focus: true, render: true };
  }

  render(width: number): string[] {
    if (this.disposed) return [];

    const safeWidth = Math.max(1, Math.floor(width));
    const title = fit(
      `${this.theme.bold("Tool-groups preview")} ${this.theme.fg("dim", `(${this.selectedIndex + 1}/${this.definitions.length})`)}`,
      safeWidth,
    );
    const hint = fit(
      this.theme.fg("muted", "↑↓ choose/scroll  Tab/→ preview  Tab/← list  Esc close"),
      safeWidth,
    );
    const header = [title, hint];
    const maxBodyRows = Math.max(3, (this.tui.terminal.rows || 24) - header.length - 1);

    if (safeWidth < 44) {
      this.sidebarBounds = undefined;
      this.previewBounds = { x: 0, y: header.length, width: safeWidth, height: maxBodyRows };
      const definition = this.definitions[this.selectedIndex];
      const preview = [
        fit(this.theme.bold(definition?.name ?? "Unknown"), safeWidth),
        fit(this.theme.fg("dim", definition?.description ?? ""), safeWidth),
        "",
        ...this.current.render(safeWidth),
      ].slice(0, maxBodyRows);
      return [...header, ...preview];
    }

    const sidebarWidth = Math.min(27, Math.max(18, Math.floor(safeWidth * 0.3)));
    const previewWidth = Math.max(1, safeWidth - sidebarWidth - 3);
    const sidebarLines = this.selector.render(sidebarWidth);
    const definition = this.definitions[this.selectedIndex];
    const previewLines = [
      fit(this.theme.bold(definition?.name ?? "Unknown"), previewWidth),
      fit(this.theme.fg("dim", definition?.description ?? ""), previewWidth),
      "",
      ...this.current.render(previewWidth),
    ];
    const bodyRows = Math.min(maxBodyRows, Math.max(sidebarLines.length, previewLines.length));
    this.sidebarBounds = { x: 0, y: header.length, width: sidebarWidth, height: bodyRows };
    this.previewBounds = {
      x: sidebarWidth + 3,
      y: header.length,
      width: previewWidth,
      height: bodyRows,
    };

    const body: string[] = [];
    for (let row = 0; row < bodyRows; row++) {
      const left = padRight(fit(sidebarLines[row] ?? "", sidebarWidth), sidebarWidth);
      const right = fit(previewLines[row] ?? "", previewWidth);
      body.push(`${left} ${this.theme.fg("borderMuted", "│")} ${right}`);
    }

    return [...header, ...body];
  }

  invalidate(): void {
    this.selector.invalidate();
    this.current.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeCurrent();
  }
}

