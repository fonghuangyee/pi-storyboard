import { Markdown, stripTerminalSequences, truncateToWidth, visibleWidth, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { GroupSnapshot, ThemeLike } from "./renderer.ts";
import {
  DEFAULT_PRESENTATION_SETTINGS,
  type PresentationSettings,
  type StoryboardColorName,
} from "./presentation-settings.ts";
import type {
  SceneState,
  StoryboardActionRun,
  StoryboardAssistantContent,
  StoryboardOrderedChild,
  StoryboardScene,
  StoryboardToolSnapshot,
  StoryboardWorkSpan,
  StoryboardChapter,
} from "./storyboard.ts";

export type StoryboardGroupRenderer = (
  group: GroupSnapshot,
  width: number,
  theme: ThemeLike,
  settings?: PresentationSettings,
) => string[];

export type StoryboardMarkerColor = StoryboardColorName;
export type StoryboardThinkingMarkerColor = StoryboardColorName;

/** A native assistant child and its visual range in a rendered story block. */
export type StoryboardAssistantRenderRegion = {
  readonly row: unknown;
  readonly start: number;
  readonly height: number;
  readonly prefixWidth: number;
  /** Source-line mapping used when an overlong thinking block is collapsed. */
  readonly sourceStart?: number;
  readonly sourceHeight?: number;
};

export type StoryboardSceneLayout = {
  readonly lines: readonly string[];
  readonly assistantRegions: readonly StoryboardAssistantRenderRegion[];
};

type StoryLayout = {
  readonly indent: string;
  readonly assistantPrefixWidth: number;
  readonly branchPrefixWidth: number;
  readonly assistantWidth: number;
  readonly settings: PresentationSettings;
};

const MAX_VISIBLE_THINKING_PARAGRAPHS = 4;
const EDGE_THINKING_PARAGRAPHS = 2;

type ThinkingPart = {
  readonly lines: readonly string[];
  readonly sourceStart: number;
  readonly sourceHeight: number;
  readonly summary?: string;
};

type AssistantBlockLayout = {
  readonly lines: readonly string[];
  readonly regions: readonly Omit<StoryboardAssistantRenderRegion, "row">[];
};

function firstDisplayCell(value: string, fallback: string): string {
  return Array.from(value)[0] ?? fallback;
}

function padPrefix(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleWidth(value)))}`;
}

function layoutForWidth(
  width: number,
  settings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): StoryLayout {
  const safeWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  const proposedIndent = safeWidth >= 50 ? " " : "";
  const indentWidth = visibleWidth(proposedIndent);
  const terminalWidth = visibleWidth(firstDisplayCell(settings.symbols.lastBranch, "╰"));
  const assistantSymbolWidth = Math.max(
    visibleWidth(settings.symbols.thinkingRoot),
    visibleWidth(settings.symbols.thinkingStep),
    visibleWidth(settings.symbols.rail),
    terminalWidth,
  );
  const proposedAssistantWidth = indentWidth + assistantSymbolWidth;
  const assistantPrefixWidth = proposedAssistantWidth < safeWidth ? proposedAssistantWidth : 0;
  const indent = assistantPrefixWidth === 0 ? "" : proposedIndent;
  const proposedBranchWidth = Math.max(
    visibleWidth(`${indent}${settings.symbols.branch}`),
    visibleWidth(`${indent}${settings.symbols.lastBranch}`),
    visibleWidth(`${indent}${settings.symbols.rail}`),
  );
  const branchPrefixWidth = proposedBranchWidth < safeWidth ? proposedBranchWidth : 0;
  return {
    indent,
    assistantPrefixWidth,
    branchPrefixWidth,
    assistantWidth: Math.max(1, safeWidth - assistantPrefixWidth),
    settings,
  };
}

/** Width supplied to native assistant content before adding the story gutter. */
export function storyboardAssistantWidth(
  width: number,
  settings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): number {
  return layoutForWidth(width, settings).assistantWidth;
}

/** Every native assistant item uses the same measured gutter width. */
export function storyboardAssistantContinuationWidth(
  width: number,
  settings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): number {
  return storyboardAssistantWidth(width, settings);
}

/** Action-root markers communicate the aggregate scene state. */
export function sceneMarkerColor(
  state: SceneState,
  settings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): StoryboardMarkerColor {
  switch (state) {
    case "running":
      return settings.colors.status.running;
    case "failed":
      return settings.colors.status.failed;
    case "complete":
      return settings.colors.status.complete;
    case "note":
      return settings.colors.status.note;
  }
}

/** Thinking markers communicate thinking lifecycle, not tool outcome. */
export function thinkingMarkerColor(
  state: SceneState,
  settings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): StoryboardThinkingMarkerColor {
  return state === "running" ? settings.colors.thinking.active : settings.colors.thinking.settled;
}

function fit(line: string, width: number): string {
  const safeWidth = Math.max(1, Math.floor(width));
  return visibleWidth(line) <= safeWidth ? line : truncateToWidth(line, safeWidth, "");
}

function hasVisibleText(line: string): boolean {
  return stripTerminalSequences(line).trim().length > 0;
}

/** Preserve the native content column when inserting a presentation summary. */
function thinkingTextIndent(lines: readonly string[]): string {
  const firstVisible = lines.find(hasVisibleText);
  if (firstVisible === undefined) return "";
  return stripTerminalSequences(firstVisible).match(/^\s*/u)?.[0] ?? "";
}

function thinkingParagraphRanges(lines: readonly string[]): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && !hasVisibleText(lines[index] ?? "")) index++;
    const start = index;
    while (index < lines.length && hasVisibleText(lines[index] ?? "")) index++;
    if (index > start) ranges.push({ start, end: index });
    while (index < lines.length && !hasVisibleText(lines[index] ?? "")) index++;
  }
  return ranges;
}

/**
 * Keep the beginning and end of long consecutive thinking output while making
 * the hidden count explicit. This changes only presentation; the native row
 * and its full text remain available behind the existing thinking toggle.
 */
function thinkingParts(
  lines: readonly string[],
  settings: PresentationSettings,
): readonly ThinkingPart[] {
  const ranges = thinkingParagraphRanges(lines);
  if (ranges.length <= MAX_VISIBLE_THINKING_PARAGRAPHS) {
    return [{ lines, sourceStart: 0, sourceHeight: lines.length }];
  }

  const first = ranges.slice(0, EDGE_THINKING_PARAGRAPHS);
  const last = ranges.slice(-EDGE_THINKING_PARAGRAPHS);
  const hiddenCount = ranges.length - first.length - last.length;
  const parts: ThinkingPart[] = first.map((range) => ({
    lines: lines.slice(range.start, range.end),
    sourceStart: range.start,
    sourceHeight: range.end - range.start,
  }));
  parts.push({
    lines: [],
    sourceStart: -1,
    sourceHeight: 0,
    summary: `${settings.symbols.hiddenThinking} ${hiddenCount} thinking ${hiddenCount === 1 ? "step" : "steps"} behind the scenes`,
  });
  parts.push(...last.map((range) => ({
    lines: lines.slice(range.start, range.end),
    sourceStart: range.start,
    sourceHeight: range.end - range.start,
  })));
  return parts;
}

function assistantMarkerPrefix(
  scene: StoryboardScene,
  aggregate: boolean,
  layout: StoryLayout,
  theme: ThemeLike,
  markerState: SceneState = scene.state,
  hasActionsOverride?: boolean,
): string {
  if (layout.assistantPrefixWidth === 0) return "";
  const hasActions = aggregate && (hasActionsOverride ?? scene.actionRuns.length > 0);
  const shape = hasActions ? layout.settings.symbols.thinkingRoot : layout.settings.symbols.thinkingStep;
  return padPrefix(
    `${layout.indent}${theme.fg(thinkingMarkerColor(markerState, layout.settings), shape)}`,
    layout.assistantPrefixWidth,
  );
}

function assistantRailPrefix(layout: StoryLayout, theme: ThemeLike): string {
  if (layout.assistantPrefixWidth === 0) return "";
  return padPrefix(
    `${layout.indent}${theme.fg(layout.settings.colors.structure, layout.settings.symbols.rail)}`,
    layout.assistantPrefixWidth,
  );
}

function renderAssistantHeader(
  scene: StoryboardScene,
  nativeLines: readonly string[],
  width: number,
  aggregate: boolean,
  layout: StoryLayout,
  theme: ThemeLike,
  markerState: SceneState = scene.state,
  hasActionsOverride?: boolean,
): AssistantBlockLayout {
  const marker = assistantMarkerPrefix(scene, aggregate, layout, theme, markerState, hasActionsOverride);
  const rail = assistantRailPrefix(layout, theme);
  const lines: string[] = [];
  const regions: Array<Omit<StoryboardAssistantRenderRegion, "row">> = [];
  let markerPlaced = false;
  const parts = thinkingParts(nativeLines, layout.settings);

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex]!;
    if (partIndex > 0) lines.push(fit(rail, width));
    if (part.summary !== undefined) {
      const summaryStart = lines.length;
      lines.push(fit(`${rail}${thinkingTextIndent(nativeLines)}${theme.fg(layout.settings.colors.structure, part.summary)}`, width));
      regions.push({
        start: summaryStart,
        height: 1,
        prefixWidth: layout.assistantPrefixWidth,
        sourceStart: 0,
        sourceHeight: nativeLines.length,
      });
      continue;
    }

    const start = lines.length;
    for (let index = 0; index < part.lines.length; index++) {
      const nativeLine = part.lines[index] ?? "";
      const visible = hasVisibleText(nativeLine);
      const startsParagraph = visible && (
        !markerPlaced || (aggregate && !hasVisibleText(part.lines[index - 1] ?? ""))
      );
      if (startsParagraph) {
        lines.push(fit(`${marker}${nativeLine}`, width));
        markerPlaced = true;
      } else {
        lines.push(fit(`${rail}${nativeLine}`, width));
      }
    }
    if (part.lines.length > 0) {
      regions.push({
        start,
        height: part.lines.length,
        prefixWidth: layout.assistantPrefixWidth,
        sourceStart: part.sourceStart,
        sourceHeight: part.sourceHeight,
      });
    }
  }

  // Hidden/empty native content stays hidden. Tool-bearing empty responses
  // receive the explicit `Thinking...` placeholder from the caller instead of
  // inventing a `Tool step` or generic work-note title here.
  return { lines, regions };
}

/**
 * Mirror Pi's AssistantMessageComponent thinking child: a pi-tui Markdown
 * component with output padding, thinking color, and italic default styling.
 * The strong Markdown wrapper gives the fixed label the same bold+italic
 * treatment as Pi's native bold thinking summaries.
 */
function thinkingPlaceholderLines(
  width: number,
  layout: StoryLayout,
  theme: ThemeLike,
): string[] {
  const passthrough = (text: string): string => text;
  const markdownTheme: MarkdownTheme = {
    heading: passthrough,
    link: passthrough,
    linkUrl: passthrough,
    code: passthrough,
    codeBlock: passthrough,
    codeBlockBorder: passthrough,
    quote: passthrough,
    quoteBorder: passthrough,
    hr: passthrough,
    listBullet: passthrough,
    bold: (text) => theme.bold?.(text) ?? text,
    italic: (text) => theme.italic?.(text) ?? text,
    strikethrough: passthrough,
    underline: passthrough,
  };
  const contentWidth = Math.max(1, width - layout.assistantPrefixWidth);
  return new Markdown(
    `**${layout.settings.symbols.thinkingPlaceholder}**`,
    1,
    0,
    markdownTheme,
    {
      color: (text) => theme.fg("thinkingText", text),
      italic: true,
    },
  ).render(contentWidth);
}

function renderEmptyThinkingHeader(
  scene: StoryboardScene,
  width: number,
  layout: StoryLayout,
  theme: ThemeLike,
): string[] {
  return [...renderAssistantHeader(
    scene,
    thinkingPlaceholderLines(width, layout, theme),
    width,
    true,
    layout,
    theme,
  ).lines];
}

/** Render the explicit same-response commentary-suffix placeholder. */
function renderSyntheticThinkingPlaceholder(
  scene: StoryboardScene,
  width: number,
  layout: StoryLayout,
  theme: ThemeLike,
): string[] {
  return [...renderAssistantHeader(
    scene,
    thinkingPlaceholderLines(width, layout, theme),
    width,
    true,
    layout,
    theme,
    scene.state,
    true,
  ).lines];
}

function branchPrefix(last: boolean, layout: StoryLayout, theme: ThemeLike): string {
  if (layout.branchPrefixWidth === 0) return "";
  return padPrefix(
    `${layout.indent}${theme.fg(
      layout.settings.colors.structure,
      last ? layout.settings.symbols.lastBranch : layout.settings.symbols.branch,
    )}`,
    layout.branchPrefixWidth,
  );
}

function groupContinuationPrefix(last: boolean, layout: StoryLayout, theme: ThemeLike): string {
  if (layout.branchPrefixWidth === 0) return "";
  if (last) return " ".repeat(layout.branchPrefixWidth);
  return padPrefix(
    `${layout.indent}${theme.fg(layout.settings.colors.structure, layout.settings.symbols.rail)}`,
    layout.branchPrefixWidth,
  );
}

function renderActionRun(
  run: StoryboardActionRun,
  last: boolean,
  width: number,
  layout: StoryLayout,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
): string[] {
  const groupWidth = Math.max(1, width - layout.branchPrefixWidth);
  const group: GroupSnapshot = Object.freeze({
    kind: run.kind,
    rows: Object.freeze(run.rows.map((row) => row.snapshot)),
  });
  const groupLines = renderGroup(group, groupWidth, theme, layout.settings);
  if (!Array.isArray(groupLines) || !groupLines.every((line) => typeof line === "string")) {
    throw new Error("storyboard group renderer returned invalid lines");
  }

  // The story rail supplies the compact group's native leading Spacer(1).
  const contentLines = groupLines.slice(1);
  if (contentLines.length === 0) throw new Error("storyboard group renderer returned no content");

  const rendered: string[] = [];
  for (let index = 0; index < contentLines.length; index++) {
    const line = contentLines[index] ?? "";
    const prefix = index === 0
      ? branchPrefix(last, layout, theme)
      : groupContinuationPrefix(last, layout, theme);
    rendered.push(fit(`${prefix}${line}`, width));
  }
  return rendered;
}

/** Tool-only turns have no native thinking content to use as a block header. */
function renderDirectActionRun(
  run: StoryboardActionRun,
  state: SceneState,
  width: number,
  layout: StoryLayout,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
): string[] {
  const groupWidth = Math.max(1, width - layout.assistantPrefixWidth);
  const group: GroupSnapshot = Object.freeze({
    kind: run.kind,
    rows: Object.freeze(run.rows.map((row) => row.snapshot)),
  });
  const groupLines = renderGroup(group, groupWidth, theme, layout.settings);
  if (!Array.isArray(groupLines) || !groupLines.every((line) => typeof line === "string")) {
    throw new Error("storyboard group renderer returned invalid lines");
  }
  const contentLines = groupLines.slice(1);
  if (contentLines.length === 0) throw new Error("storyboard group renderer returned no content");

  const marker = layout.assistantPrefixWidth === 0
    ? ""
    : padPrefix(
      `${layout.indent}${theme.fg(
        sceneMarkerColor(state, layout.settings),
        layout.settings.symbols.thinkingRoot,
      )}`,
      layout.assistantPrefixWidth,
    );
  const continuation = " ".repeat(layout.assistantPrefixWidth);
  return contentLines.map((line, index) => fit(`${index === 0 ? marker : continuation}${line}`, width));
}

function isNativeSpacer(content: StoryboardAssistantContent): boolean {
  return content.type === "native" &&
    content.renderedLines.length > 0 &&
    content.renderedLines.every((line) => !hasVisibleText(line));
}

function renderAssistantContinuation(
  content: StoryboardAssistantContent,
  terminal: boolean,
  width: number,
  layout: StoryLayout,
  theme: ThemeLike,
  markerColor?: StoryboardThinkingMarkerColor,
): AssistantBlockLayout {
  const rail = assistantRailPrefix(layout, theme);
  const terminalSymbol = firstDisplayCell(layout.settings.symbols.lastBranch, "╰");
  const terminalPrefix = layout.assistantPrefixWidth === 0
    ? ""
    : padPrefix(
      `${layout.indent}${theme.fg(layout.settings.colors.structure, terminalSymbol)}`,
      layout.assistantPrefixWidth,
    );
  const terminalContinuation = " ".repeat(layout.assistantPrefixWidth);
  const thinkingMarker = layout.assistantPrefixWidth === 0
    ? ""
    : padPrefix(
      `${layout.indent}${theme.fg(
        markerColor ?? layout.settings.colors.thinking.settled,
        layout.settings.symbols.thinkingStep,
      )}`,
      layout.assistantPrefixWidth,
    );
  const lines: string[] = [];
  const regions: Array<Omit<StoryboardAssistantRenderRegion, "row">> = [];
  const parts = content.type === "thinking"
    ? thinkingParts(content.renderedLines, layout.settings)
    : [{ lines: content.renderedLines, sourceStart: 0, sourceHeight: content.renderedLines.length }];

  let firstVisibleOverall = true;
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex]!;
    if (partIndex > 0) lines.push(fit(rail, width));
    if (part.summary !== undefined) {
      const summaryStart = lines.length;
      lines.push(fit(`${rail}${thinkingTextIndent(content.renderedLines)}${theme.fg(layout.settings.colors.structure, part.summary)}`, width));
      regions.push({
        start: summaryStart,
        height: 1,
        prefixWidth: layout.assistantPrefixWidth,
        sourceStart: 0,
        sourceHeight: content.renderedLines.length,
      });
      continue;
    }

    const start = lines.length;
    const firstVisible = part.lines.findIndex(hasVisibleText);
    for (let index = 0; index < part.lines.length; index++) {
      const line = part.lines[index] ?? "";
      const startsParagraph = content.type === "thinking" && hasVisibleText(line) && (
        firstVisibleOverall || index === firstVisible || !hasVisibleText(part.lines[index - 1] ?? "")
      );
      const isTerminalStart = terminal && firstVisibleOverall && index === firstVisible;
      const prefix = isTerminalStart
        ? terminalPrefix
        : startsParagraph
          ? thinkingMarker
          : terminal && !firstVisibleOverall && firstVisible >= 0 && index > firstVisible
            ? terminalContinuation
            : rail;
      lines.push(fit(`${prefix}${line}`, width));
      if (hasVisibleText(line) && firstVisibleOverall && index === firstVisible) {
        firstVisibleOverall = false;
      }
    }
    if (part.lines.length > 0) {
      regions.push({
        start,
        height: part.lines.length,
        prefixWidth: layout.assistantPrefixWidth,
        sourceStart: part.sourceStart,
        sourceHeight: part.sourceHeight,
      });
    }
  }

  return { lines, regions };
}

type OrderedRenderNode =
  | { readonly type: "assistant"; readonly content: StoryboardAssistantContent }
  | { readonly type: "group"; readonly run: StoryboardActionRun };

function orderedRenderNodes(children: readonly StoryboardOrderedChild[]): OrderedRenderNode[] {
  const nodes: OrderedRenderNode[] = [];
  let pendingKind: StoryboardActionRun["kind"] | undefined;
  let pendingRows: StoryboardToolSnapshot[] = [];

  const flush = (): void => {
    if (pendingKind === undefined || pendingRows.length === 0) return;
    nodes.push({
      type: "group",
      run: Object.freeze({
        kind: pendingKind,
        rows: Object.freeze([...pendingRows]),
      }),
    });
    pendingKind = undefined;
    pendingRows = [];
  };

  for (const child of children) {
    if (child.type === "assistant") {
      flush();
      nodes.push({ type: "assistant", content: child.content });
      continue;
    }
    if (pendingKind !== child.tool.kind) {
      flush();
      pendingKind = child.tool.kind;
    }
    pendingRows.push(child.tool);
  }
  flush();
  return nodes;
}

function leadingNativeLines(lines: readonly string[]): { leading: string[]; count: number } {
  const leading: string[] = [];
  for (const line of lines) {
    if (hasVisibleText(line)) break;
    // Preserve native OSC boundaries attached to Pi's leading spacer.
    leading.push(line);
  }
  return { leading, count: leading.length };
}

function terminalNodeIndex(nodes: readonly OrderedRenderNode[], start: number): number {
  for (let index = nodes.length - 1; index >= start; index--) {
    const node = nodes[index];
    if (node?.type !== "assistant" || !isNativeSpacer(node.content)) return index;
  }
  return -1;
}

function orderedSceneLayout(
  scene: StoryboardScene,
  nativeAssistantLines: readonly string[],
  width: number,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
  settings: PresentationSettings,
): StoryboardSceneLayout {
  const safeWidth = Math.max(1, Math.floor(width));
  const layout = layoutForWidth(safeWidth, settings);
  const nodes = orderedRenderNodes(scene.orderedChildren ?? []);
  const nativeLeading = leadingNativeLines(nativeAssistantLines);
  const lines = [...nativeLeading.leading];
  const assistantRegions: StoryboardAssistantRenderRegion[] = [];

  let nodeStart = 0;
  if (nodes[0]?.type === "assistant" && nodes[0].content.type === "thinking") {
    const first = nodes[0].content;
    nodeStart = 1;
    const start = lines.length;
    const header = renderAssistantHeader(
      scene,
      first.renderedLines,
      safeWidth,
      true,
      layout,
      theme,
    );
    lines.push(...header.lines);
    for (const region of header.regions) {
      assistantRegions.push({ row: first.row, ...region, start: start + region.start });
    }
  } else if (scene.actionRuns.length > 0 && !scene.assistant.hasThinking) {
    lines.push(...renderEmptyThinkingHeader(scene, safeWidth, layout, theme));
  }

  if (nodes.length > 0 && nodes.every((node) => node.type === "group")) {
    if (scene.actionRuns.length > 0) lines.push(fit(assistantRailPrefix(layout, theme), safeWidth));
    for (let index = 0; index < nodes.length; index++) {
      if (index > 0) lines.push(fit(assistantRailPrefix(layout, theme), safeWidth));
      lines.push(...renderActionRun(
        (nodes[index] as Extract<OrderedRenderNode, { type: "group" }>).run,
        index === nodes.length - 1,
        safeWidth,
        layout,
        theme,
        renderGroup,
      ));
    }
    return { lines, assistantRegions };
  } else {
    // A tool before the first assistant item cannot be given a truthful
    // thinking-led hierarchy. Keep source order and use it as a direct root.
    const first = nodes[0];
    if (first?.type === "group") {
      lines.push(...renderDirectActionRun(first.run, scene.state, safeWidth, layout, theme, renderGroup));
      nodeStart = 1;
    }
  }

  const terminalIndex = terminalNodeIndex(nodes, nodeStart);
  const remaining = nodes.slice(nodeStart);
  if (remaining.length === 0) return { lines, assistantRegions };

  if (!(remaining[0]?.type === "assistant" && isNativeSpacer(remaining[0].content))) {
    lines.push(fit(assistantRailPrefix(layout, theme), safeWidth));
  }

  for (let relativeIndex = 0; relativeIndex < remaining.length; relativeIndex++) {
    const node = remaining[relativeIndex]!;
    const absoluteIndex = nodeStart + relativeIndex;
    const terminal = absoluteIndex === terminalIndex;

    if (node.type === "group") {
      lines.push(...renderActionRun(
        node.run,
        terminal,
        safeWidth,
        layout,
        theme,
        renderGroup,
      ));
    } else if (isNativeSpacer(node.content)) {
      const rail = absoluteIndex > terminalIndex ? "" : assistantRailPrefix(layout, theme);
      for (const line of node.content.renderedLines) lines.push(fit(`${rail}${line}`, safeWidth));
    } else {
      const start = lines.length;
      const continuation = renderAssistantContinuation(
        node.content,
        terminal,
        safeWidth,
        layout,
        theme,
        thinkingMarkerColor(scene.state, layout.settings),
      );
      lines.push(...continuation.lines);
      for (const region of continuation.regions) {
        assistantRegions.push({ row: node.content.row, ...region, start: start + region.start });
      }
    }

    if (relativeIndex < remaining.length - 1) {
      const next = remaining[relativeIndex + 1];
      const currentIsSpacer = node.type === "assistant" && isNativeSpacer(node.content);
      const nextIsSpacer = next?.type === "assistant" && isNativeSpacer(next.content);
      if (!currentIsSpacer && !nextIsSpacer) {
        lines.push(fit(assistantRailPrefix(layout, theme), safeWidth));
      }
    }
  }

  return { lines, assistantRegions };
}

function legacySceneLayout(
  scene: StoryboardScene,
  nativeAssistantLines: readonly string[],
  width: number,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
  settings: PresentationSettings,
): StoryboardSceneLayout {
  const safeWidth = Math.max(1, Math.floor(width));
  const layout = layoutForWidth(safeWidth, settings);
  const leading = leadingNativeLines(nativeAssistantLines);
  const body = nativeAssistantLines.slice(leading.count);
  const lines = [...leading.leading];
  const assistantRegions: StoryboardAssistantRenderRegion[] = [];
  if (body.length === 0 && scene.actionRuns.length > 0) {
    lines.push(...renderEmptyThinkingHeader(scene, safeWidth, layout, theme));
    lines.push(fit(assistantRailPrefix(layout, theme), safeWidth));
    for (let index = 0; index < scene.actionRuns.length; index++) {
      if (index > 0) lines.push(fit(assistantRailPrefix(layout, theme), safeWidth));
      lines.push(...renderActionRun(
        scene.actionRuns[index]!,
        index === scene.actionRuns.length - 1,
        safeWidth,
        layout,
        theme,
        renderGroup,
      ));
    }
    return { lines, assistantRegions };
  }

  const headerStart = lines.length;
  const header = renderAssistantHeader(
    scene,
    body,
    safeWidth,
    scene.assistant.hasThinking,
    layout,
    theme,
  );
  lines.push(...header.lines);
  for (const region of header.regions) {
    assistantRegions.push({ row: scene.assistant.assistantRow, ...region, start: headerStart + region.start });
  }

  if (scene.actionRuns.length === 0) return { lines, assistantRegions };
  lines.push(fit(assistantRailPrefix(layout, theme), safeWidth));
  for (let index = 0; index < scene.actionRuns.length; index++) {
    const last = index === scene.actionRuns.length - 1;
    lines.push(...renderActionRun(
      scene.actionRuns[index]!,
      last,
      safeWidth,
      layout,
      theme,
      renderGroup,
    ));
    if (!last) lines.push(fit(assistantRailPrefix(layout, theme), safeWidth));
  }
  return { lines, assistantRegions };
}

/**
 * Render one validated Pi turn as a story block. The header is native thinking
 * content, not a persisted master record; `╰─` closes the turn's final child.
 */
export function renderStoryboardSceneLayout(
  scene: StoryboardScene,
  nativeAssistantLines: readonly string[],
  width: number,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
  settings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): StoryboardSceneLayout {
  return scene.orderedChildren === undefined
    ? legacySceneLayout(scene, nativeAssistantLines, width, theme, renderGroup, settings)
    : orderedSceneLayout(scene, nativeAssistantLines, width, theme, renderGroup, settings);
}

function renderWorkChapter(
  chapter: StoryboardChapter,
  span: StoryboardWorkSpan,
  width: number,
  layout: StoryLayout,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
  lines: string[],
  regions: StoryboardAssistantRenderRegion[],
): void {
  const items = chapter.items;
  if (items.length === 0) return;
  const terminalIndex = items.length - 1;
  const spanHasActions = span.chapters.some((candidate) => candidate.items.some((item) => item.type === "action"));
  // A multi-scene work span is only produced by the validated empty-thinking
  // continuation. Its scenes remain separate ownership units, but adjacent
  // same-kind actions may share one visual compact group.
  const canMergeContinuationActions = span.scenes.length > 1;

  for (let index = 0; index < items.length;) {
    const item = items[index]!;
    let endIndex = index;
    let renderItem = item;

    if (canMergeContinuationActions && item.type === "action") {
      const rows = [...item.run.rows];
      let lastScene = item.scene;
      while (endIndex + 1 < items.length) {
        const next = items[endIndex + 1];
        if (
          next?.type !== "action" ||
          next.run.kind !== item.run.kind ||
          next.scene === lastScene
        ) {
          break;
        }
        rows.push(...next.run.rows);
        lastScene = next.scene;
        endIndex++;
      }
      if (endIndex !== index) {
        renderItem = Object.freeze({
          type: "action",
          scene: item.scene,
          run: Object.freeze({
            kind: item.run.kind,
            rows: Object.freeze(rows),
          }),
        });
      }
    }

    if (index > 0) lines.push(fit(assistantRailPrefix(layout, theme), width));
    const terminal = endIndex === terminalIndex;
    if (renderItem.type === "synthetic-thinking-placeholder") {
      lines.push(...renderSyntheticThinkingPlaceholder(renderItem.scene, width, layout, theme));
    } else if (renderItem.type === "thinking") {
      const start = lines.length;
      const block = index === 0
        ? renderAssistantHeader(
          renderItem.scene,
          renderItem.content.renderedLines,
          width,
          true,
          layout,
          theme,
          span.state,
          spanHasActions,
        )
        : renderAssistantContinuation(renderItem.content, terminal, width, layout, theme, thinkingMarkerColor(renderItem.scene.state, layout.settings));
      lines.push(...block.lines);
      for (const region of block.regions) {
        regions.push({ row: renderItem.content.row, ...region, start: start + region.start });
      }
    } else if (index === 0) {
      lines.push(...renderDirectActionRun(
        renderItem.run,
        span.state,
        width,
        layout,
        theme,
        renderGroup,
      ));
    } else {
      lines.push(...renderActionRun(
        renderItem.run,
        terminal,
        width,
        layout,
        theme,
        renderGroup,
      ));
    }

    index = endIndex + 1;
  }
}

/**
 * Render a validated sequence of turn scenes as one presentation-only work
 * span. Commentary is emitted with its native child at full width; it is not
 * prefixed, summarized, or moved across the tool stream.
 */
export function renderStoryboardWorkSpanLayout(
  span: StoryboardWorkSpan,
  width: number,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
  settings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): StoryboardSceneLayout {
  const safeWidth = Math.max(1, Math.floor(width));
  const layout = layoutForWidth(safeWidth, settings);
  const firstScene = span.scenes[0];
  if (firstScene === undefined) throw new Error("work span has no scenes");

  const leading = leadingNativeLines(firstScene.assistant.renderedAssistantLines);
  const lines = [...leading.leading];
  const assistantRegions: StoryboardAssistantRenderRegion[] = [];
  if (leading.count === 0) lines.push("");

  for (let partIndex = 0; partIndex < span.parts.length; partIndex++) {
    const part = span.parts[partIndex]!;
    if (part.type === "chapter") {
      renderWorkChapter(part, span, safeWidth, layout, theme, renderGroup, lines, assistantRegions);
      continue;
    }

    if (lines.length > 0) lines.push("");
    const start = lines.length;
    for (const line of part.content.renderedLines) {
      if (visibleWidth(line) > safeWidth) throw new Error("commentary exceeds terminal width");
      lines.push(line);
    }
    if (part.content.renderedLines.length > 0) {
      assistantRegions.push({
        row: part.content.row,
        start,
        height: part.content.renderedLines.length,
        prefixWidth: 0,
        sourceStart: 0,
        sourceHeight: part.content.renderedLines.length,
      });
    }
    if (partIndex < span.parts.length - 1) lines.push("");
  }

  return { lines, assistantRegions };
}

/**
 * Decorate only native thinking children when a response also contains a
 * final/unknown text block. The text remains Pi-native and unprefixed; this
 * gives intermediate thinking a visible start marker without classifying the
 * final answer as a storyboard action. Thinking markers use the assistant's
 * running/settled lifecycle rather than any tool outcome.
 */
function renderThinkingMarkerBlock(
  nativeLines: readonly string[],
  width: number,
  layout: StoryLayout,
  theme: ThemeLike,
  markerColor: StoryboardThinkingMarkerColor = DEFAULT_PRESENTATION_SETTINGS.colors.thinking.settled,
): AssistantBlockLayout {
  const rail = assistantRailPrefix(layout, theme);
  const thinkingMarker = layout.assistantPrefixWidth === 0
    ? ""
    : padPrefix(
      `${layout.indent}${theme.fg(markerColor, layout.settings.symbols.thinkingStep)}`,
      layout.assistantPrefixWidth,
    );
  const lines: string[] = [];
  const regions: Array<Omit<StoryboardAssistantRenderRegion, "row">> = [];
  const parts = thinkingParts(nativeLines, layout.settings);

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex]!;
    if (partIndex > 0) lines.push(fit(rail, width));
    if (part.summary !== undefined) {
      const summaryStart = lines.length;
      lines.push(fit(`${rail}${thinkingTextIndent(nativeLines)}${theme.fg(layout.settings.colors.structure, part.summary)}`, width));
      regions.push({
        start: summaryStart,
        height: 1,
        prefixWidth: layout.assistantPrefixWidth,
        sourceStart: 0,
        sourceHeight: nativeLines.length,
      });
      continue;
    }

    const start = lines.length;
    let markerPlaced = false;
    for (let index = 0; index < part.lines.length; index++) {
      const line = part.lines[index] ?? "";
      const startsParagraph = hasVisibleText(line) && (
        !markerPlaced || !hasVisibleText(part.lines[index - 1] ?? "")
      );
      const prefix = startsParagraph ? thinkingMarker : rail;
      lines.push(fit(`${prefix}${line}`, width));
      if (hasVisibleText(line)) markerPlaced = true;
    }
    if (part.lines.length > 0) {
      regions.push({
        start,
        height: part.lines.length,
        prefixWidth: layout.assistantPrefixWidth,
        sourceStart: part.sourceStart,
        sourceHeight: part.sourceHeight,
      });
    }
  }
  return { lines, regions };
}

export function renderNativeThinkingMarkersLayout(
  nativeAssistantLines: readonly string[],
  assistantContent: readonly StoryboardAssistantContent[],
  width: number,
  theme: ThemeLike,
  markerColor: StoryboardThinkingMarkerColor = DEFAULT_PRESENTATION_SETTINGS.colors.thinking.settled,
  settings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): StoryboardSceneLayout {
  const safeWidth = Math.max(1, Math.floor(width));
  const layout = layoutForWidth(safeWidth, settings);
  const contentLineCount = assistantContent.reduce(
    (total, content) => total + content.renderedLines.length,
    0,
  );
  const contentStart = Math.max(0, nativeAssistantLines.length - contentLineCount);
  const lines = [...nativeAssistantLines.slice(0, contentStart)];
  const assistantRegions: StoryboardAssistantRenderRegion[] = [];

  for (const content of assistantContent) {
    if (content.type === "thinking") {
      const block = renderThinkingMarkerBlock(content.renderedLines, safeWidth, layout, theme, markerColor);
      for (const region of block.regions) {
        assistantRegions.push({
          row: content.row,
          ...region,
          start: lines.length + region.start,
        });
      }
      lines.push(...block.lines);
    } else {
      lines.push(...content.renderedLines);
    }
  }

  const contentEnd = contentStart + contentLineCount;
  lines.push(...nativeAssistantLines.slice(contentEnd));
  return { lines, assistantRegions };
}

export function renderStoryboardScene(
  scene: StoryboardScene,
  nativeAssistantLines: readonly string[],
  width: number,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
  settings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): string[] {
  return [...renderStoryboardSceneLayout(scene, nativeAssistantLines, width, theme, renderGroup, settings).lines];
}
