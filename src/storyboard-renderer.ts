import { sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { GroupSnapshot, ThemeLike } from "./renderer.ts";
import type {
  SceneState,
  StoryboardActionRun,
  StoryboardAssistantContent,
  StoryboardOrderedChild,
  StoryboardScene,
  StoryboardToolSnapshot,
} from "./storyboard.ts";

export type StoryboardGroupRenderer = (
  group: GroupSnapshot,
  width: number,
  theme: ThemeLike,
) => string[];

export type StoryboardMarkerColor = "muted" | "success" | "error" | "syntaxKeyword";

/** A native assistant child and its visual range in a rendered scene. */
export type StoryboardAssistantRenderRegion = {
  readonly row: unknown;
  readonly start: number;
  readonly height: number;
  readonly prefixWidth: number;
};

export type StoryboardSceneLayout = {
  readonly lines: readonly string[];
  readonly assistantRegions: readonly StoryboardAssistantRenderRegion[];
};

function layoutForWidth(width: number): { headerIndent: string; markerPrefix: string; childIndent: string } {
  const safeWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  // Match Pi's ordinary output padding: one leading cell at normal widths,
  // with only the marker/rail adding structure beyond it.
  const headerIndent = safeWidth >= 50 ? " " : "";
  const markerPrefix = `${headerIndent}◉ `;
  const childIndent = safeWidth >= 50 ? "   " : safeWidth >= 30 ? " " : "";
  return { headerIndent, markerPrefix, childIndent };
}

/** The marker has one stable meaning; only the aggregate state changes its color. */
export function sceneMarkerColor(state: SceneState): StoryboardMarkerColor {
  switch (state) {
    case "running":
      return "syntaxKeyword";
    case "failed":
      return "error";
    case "complete":
      return "success";
    case "note":
      return "muted";
  }
}

/** Width available to the native assistant component before adding the marker rail. */
export function storyboardAssistantWidth(width: number): number {
  const safeWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  const { markerPrefix } = layoutForWidth(safeWidth);
  return Math.max(1, safeWidth - visibleWidth(markerPrefix));
}

/** Width available to a later native assistant child below the scene rail. */
export function storyboardAssistantContinuationWidth(width: number): number {
  const safeWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  const { childIndent } = layoutForWidth(safeWidth);
  return Math.max(1, safeWidth - visibleWidth(`${childIndent}│  `));
}

function statusText(scene: StoryboardScene): string {
  const count = scene.actionRuns.reduce((total, run) => total + run.rows.length, 0);
  // A streaming note is still a note visually; its running state is conveyed
  // by color rather than by changing the marker shape or inventing an action
  // count.
  if (count === 0) return "note";
  return `${count} ${count === 1 ? "action" : "actions"}${scene.state === "failed" ? " · failed" : ""}`;
}

function fit(line: string, width: number): string {
  const safeWidth = Math.max(1, Math.floor(width));
  return visibleWidth(line) <= safeWidth ? line : truncateToWidth(line, safeWidth, "");
}

function renderAssistantHeader(
  scene: StoryboardScene,
  nativeLines: readonly string[],
  width: number,
  theme: ThemeLike,
): string[] {
  const { headerIndent } = layoutForWidth(width);
  const markerShape = scene.actionRuns.length === 0 ? "○" : "◉";
  const marker = theme.fg(sceneMarkerColor(scene.state), markerShape);
  const status = theme.fg("muted", statusText(scene));
  const lines: string[] = [];
  let markerPlaced = false;

  for (const nativeLine of nativeLines) {
    if (!markerPlaced && visibleWidth(nativeLine) > 0) {
      const prefix = `${headerIndent}${marker} `;
      // Pi's Text/Markdown components pad native lines to their available
      // width. Reclaim only that trailing blank padding for the optional
      // status; never append past the native layout budget.
      const contentLine = nativeLine.replace(/\s+$/u, "");
      const withStatus = `${prefix}${contentLine}`;
      const canShowStatus = width >= 80 && visibleWidth(withStatus) + 2 + visibleWidth(status) <= width;
      const candidate = canShowStatus
        ? `${withStatus}${" ".repeat(width - visibleWidth(withStatus) - visibleWidth(status))}${status}`
        : `${prefix}${nativeLine}`;
      lines.push(fit(candidate, width));
      markerPlaced = true;
    } else {
      // Keep every native line, including native blank spacers. The prefix is
      // structural only and is never allowed to consume the native content.
      lines.push(fit(`${headerIndent}  ${nativeLine}`, width));
    }
  }

  if (!markerPlaced) {
    const title = theme.fg("thinkingText", scene.actionRuns.length === 0 ? "Work note" : "Tool step");
    const titleLine = `${headerIndent}${marker} ${title}`;
    const canShowStatus = width >= 80 && visibleWidth(titleLine) + 2 + visibleWidth(status) <= width;
    const suffix = canShowStatus
      ? `${" ".repeat(width - visibleWidth(titleLine) - visibleWidth(status))}${status}`
      : "";
    lines.push(fit(`${titleLine}${suffix}`, width));
  }
  return lines;
}

function renderActionRun(
  run: StoryboardActionRun,
  last: boolean,
  width: number,
  childIndent: string,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
): string[] {
  const branch = last ? "╰─ " : "├─ ";
  const groupWidth = Math.max(1, width - visibleWidth(childIndent) - visibleWidth(branch));
  const group: GroupSnapshot = Object.freeze({
    kind: run.kind,
    rows: Object.freeze(run.rows.map((row) => row.snapshot)),
  });
  const groupLines = renderGroup(group, groupWidth, theme);
  if (!Array.isArray(groupLines) || !groupLines.every((line) => typeof line === "string")) {
    throw new Error("storyboard group renderer returned invalid lines");
  }

  // The group renderer's native Spacer(1) is represented by the scene rail
  // already emitted before this run. Avoid introducing a second blank row.
  const contentLines = groupLines.slice(1);
  const rendered: string[] = [];
  for (let index = 0; index < contentLines.length; index++) {
    const line = contentLines[index] ?? "";
    if (index === 0) {
      const heading = line.startsWith(" ") ? line.slice(1) : line;
      rendered.push(fit(`${childIndent}${branch}${heading}`, width));
    } else if (line.length === 0) {
      rendered.push(fit(`${childIndent}${last ? "   " : "│"}`, width));
    } else {
      // renderToolGroup preserves two ordinary padding cells before each
      // bullet. The scene rail already supplies that indentation, so remove
      // only those leading cells when nesting the row under a branch.
      const groupContent = stripTerminalSequences(line).startsWith("  ")
        ? sliceByColumn(line, 2, Math.max(0, visibleWidth(line) - 2), true)
        : line;
      rendered.push(fit(`${childIndent}${last ? "   " : "│  "}${groupContent}`, width));
    }
  }
  return rendered;
}

function isNativeSpacer(content: StoryboardAssistantContent): boolean {
  return content.type === "native" &&
    content.renderedLines.length > 0 &&
    content.renderedLines.every((line) => visibleWidth(line) === 0);
}

function renderAssistantContinuation(
  content: StoryboardAssistantContent,
  width: number,
  childIndent: string,
): string[] {
  const prefix = `${childIndent}│  `;
  return content.renderedLines.map((line) => {
    if (visibleWidth(line) === 0) return fit(`${childIndent}│`, width);
    return fit(`${prefix}${line}`, width);
  });
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
      run: Object.freeze({ kind: pendingKind, rows: Object.freeze([...pendingRows]) }),
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

function legacySceneLayout(
  scene: StoryboardScene,
  nativeAssistantLines: readonly string[],
  width: number,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
): StoryboardSceneLayout {
  const safeWidth = Math.max(1, Math.floor(width));
  const { childIndent, markerPrefix } = layoutForWidth(safeWidth);
  const lines = renderAssistantHeader(scene, nativeAssistantLines, safeWidth, theme);
  const assistantRegions: StoryboardAssistantRenderRegion[] = nativeAssistantLines.length > 0
    ? [{
        row: scene.assistant.assistantRow,
        start: 0,
        height: lines.length,
        prefixWidth: visibleWidth(markerPrefix),
      }]
    : [];

  if (scene.actionRuns.length === 0) return { lines, assistantRegions };

  lines.push(fit(`${childIndent}│`, safeWidth));
  for (let index = 0; index < scene.actionRuns.length; index++) {
    const run = scene.actionRuns[index]!;
    lines.push(...renderActionRun(
      run,
      index === scene.actionRuns.length - 1,
      safeWidth,
      childIndent,
      theme,
      renderGroup,
    ));
    if (index < scene.actionRuns.length - 1) {
      lines.push(fit(`${childIndent}│`, safeWidth));
    }
  }
  return { lines, assistantRegions };
}

/** Render a scene with source-order native assistant content and tool groups. */
function orderedSceneLayout(
  scene: StoryboardScene,
  nativeAssistantLines: readonly string[],
  width: number,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
): StoryboardSceneLayout {
  const safeWidth = Math.max(1, Math.floor(width));
  const { childIndent, markerPrefix } = layoutForWidth(safeWidth);
  const nodes = orderedRenderNodes(scene.orderedChildren ?? []);
  const lines: string[] = [];
  const assistantRegions: StoryboardAssistantRenderRegion[] = [];

  // The leading Spacer belongs to Pi's assistant component, not to a content
  // block. Keep its exact vertical presence before the scene marker.
  for (const line of nativeAssistantLines) {
    if (visibleWidth(line) !== 0) break;
    lines.push("");
  }

  let nodeStart = 0;
  if (nodes[0]?.type === "assistant") {
    const first = nodes[0].content;
    nodeStart = 1;
    const start = lines.length;
    const headerLines = renderAssistantHeader(scene, first.renderedLines, safeWidth, theme);
    lines.push(...headerLines);
    if (first.renderedLines.length > 0 && headerLines.length === first.renderedLines.length) {
      assistantRegions.push({
        row: first.row,
        start,
        height: headerLines.length,
        prefixWidth: visibleWidth(markerPrefix),
      });
    }
  } else {
    const headerLines = renderAssistantHeader(scene, [], safeWidth, theme);
    lines.push(...headerLines);
    // There is no native child under a tool-only title to receive mouse input.
  }

  const remaining = nodes.slice(nodeStart);
  if (remaining.length === 0) return { lines, assistantRegions };

  // A native spacer immediately following the header is itself the one
  // vertical boundary needed before the first child. Reuse it as the rail
  // rather than adding a duplicate blank row.
  if (!(remaining[0]?.type === "assistant" && isNativeSpacer(remaining[0].content))) {
    lines.push(fit(`${childIndent}│`, safeWidth));
  }
  for (let index = 0; index < remaining.length; index++) {
    const node = remaining[index]!;
    const last = index === remaining.length - 1;
    if (node.type === "group") {
      lines.push(...renderActionRun(node.run, last, safeWidth, childIndent, theme, renderGroup));
    } else {
      const start = lines.length;
      const continuation = renderAssistantContinuation(node.content, safeWidth, childIndent);
      lines.push(...continuation);
      if (node.content.renderedLines.length > 0 && continuation.length === node.content.renderedLines.length) {
        assistantRegions.push({
          row: node.content.row,
          start,
          height: continuation.length,
          prefixWidth: visibleWidth(`${childIndent}│  `),
        });
      }
    }
    if (!last) {
      const next = remaining[index + 1];
      const currentIsSpacer = node.type === "assistant" && isNativeSpacer(node.content);
      const nextIsSpacer = next?.type === "assistant" && isNativeSpacer(next.content);
      if (!currentIsSpacer && !nextIsSpacer) {
        lines.push(fit(`${childIndent}│`, safeWidth));
      }
    }
  }

  return { lines, assistantRegions };
}

/**
 * Render one validated scene while delegating assistant content and action
 * details to native renderers. When ordered children are available, thinking
 * and text components are composed at their source positions around compact
 * contiguous tool groups.
 */
export function renderStoryboardSceneLayout(
  scene: StoryboardScene,
  nativeAssistantLines: readonly string[],
  width: number,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
): StoryboardSceneLayout {
  // Notes have no tool interleaving and retain the complete native assistant
  // render, including Pi's OSC 133 boundaries and native diagnostic tail.
  const hasTools = scene.orderedChildren?.some((child) => child.type === "tool") ?? false;
  return hasTools
    ? orderedSceneLayout(scene, nativeAssistantLines, width, theme, renderGroup)
    : legacySceneLayout(scene, nativeAssistantLines, width, theme, renderGroup);
}

export function renderStoryboardScene(
  scene: StoryboardScene,
  nativeAssistantLines: readonly string[],
  width: number,
  theme: ThemeLike,
  renderGroup: StoryboardGroupRenderer,
): string[] {
  return [...renderStoryboardSceneLayout(scene, nativeAssistantLines, width, theme, renderGroup).lines];
}
