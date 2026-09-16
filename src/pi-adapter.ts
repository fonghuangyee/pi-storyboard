import {
  AssistantMessageComponent,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
  sanitizeDisplay,
  type GroupSnapshot,
  type ThemeLike,
  type ToolResultSnapshot,
  type ToolRowSnapshot,
  type ToolName,
} from "./renderer.ts";
import {
  segmentChildren,
  type ChildClassification,
  type GroupKind,
  type Segment,
} from "./grouping.ts";
import {
  buildStoryboard,
  type AssistantSceneSnapshot,
  type StoryboardAssistantContent,
  type StoryboardChild,
  type StoryboardSourceItem,
} from "./storyboard.ts";
import {
  renderStoryboardSceneLayout,
  storyboardAssistantWidth,
  type StoryboardAssistantRenderRegion,
} from "./storyboard-renderer.ts";

export const PATCH_MARKER = Symbol.for("pi-tool-groups.container.v1");

export type PatchHandle = {
  uninstall(): void;
};

export type ToolGroupingPatchOptions = {
  getTheme(): ThemeLike;
  renderGroup(group: GroupSnapshot, width: number, theme: ThemeLike): string[];
};

type ContainerRender = (this: Container, width: number) => string[];

type MouseLayout = {
  width: number;
  children: Array<{ component: Component; height: number }>;
};

/**
 * Container keeps its mouse hit-test layout private. Rebuilding the equivalent
 * layout is necessary when a visual group replaces several direct children;
 * otherwise clicks on following native rows would use stale coordinates.
 */
function setMouseLayout(
  container: Container,
  width: number,
  children: Array<{ component: Component; height: number }>,
): void {
  (container as unknown as { mouseLayout?: MouseLayout }).mouseLayout = {
    width,
    children,
  };
}

/** A grouped summary is presentation-only and intentionally has no click action. */
const GROUP_MOUSE_SINK: Component = {
  render: () => [],
  invalidate: () => undefined,
  handleMouse: () => undefined,
};

type PatchState = {
  original: ContainerRender;
  originalDescriptor: PropertyDescriptor;
  wrapper: ContainerRender;
  owners: number;
  enabled: boolean;
  options?: ToolGroupingPatchOptions;
};

type CandidateClassification = {
  kind: GroupKind;
  snapshot: ToolRowSnapshot;
  toolCallId?: string;
};

type AssistantContentKind = "thinking" | "text" | "native";

type AssistantMetadata = Omit<AssistantSceneSnapshot, "renderedAssistantLines" | "assistantContent" | "sourceOrder"> & {
  readonly contentKinds: readonly AssistantContentKind[];
  readonly sourceOrder: readonly StoryboardSourceItem[];
  readonly hasVisibleContent: boolean;
};

type AssistantPresentation = {
  readonly parts: readonly StoryboardAssistantContent[];
};

function groupKindForTool(toolName: ToolName): GroupKind | undefined {
  switch (toolName) {
    case "edit":
      return "edit";
    case "read":
      return "read";
    case "grep":
    case "find":
      return "search";
    case "ls":
      return "list";
    case "write":
      return "write";
    case "bash":
    case "powershell":
      return "command";
    default:
      // ToolExecutionComponent also represents custom, MCP, and subagent
      // calls. They share a generic presentation while retaining toolName.
      return "tool";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function hasOnlyKnownKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const known = new Set(keys);
  return Object.keys(value).every((key) => known.has(key));
}

/**
 * Copy the JSON-like state exposed by a tool row. In particular, do not freeze
 * Pi's actual argument/result objects: a renderer supplied by another
 * extension must never be able to mutate the live transcript through us.
 */
function copySnapshot(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null || typeof value !== "object") return value;

  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(copySnapshot(item, seen));
    return Object.freeze(copy);
  }

  const copy = Object.create(null) as Record<string, unknown>;
  const object = value as Record<string, unknown>;
  seen.set(value, copy);
  for (const key of Object.keys(object)) {
    copy[key] = copySnapshot(object[key], seen);
  }
  return Object.freeze(copy);
}

function resultErrorState(value: unknown): boolean | undefined {
  if (!isRecord(value) || !Array.isArray(value.content) || typeof value.isError !== "boolean") {
    return undefined;
  }

  // Validate the result shape without copying potentially large edit details,
  // diffs, patches, or tool output into an edit snapshot.
  for (const rawBlock of value.content) {
    if (!isRecord(rawBlock) || typeof rawBlock.type !== "string") return undefined;
    if (hasOwn(rawBlock, "text") && rawBlock.text !== undefined && typeof rawBlock.text !== "string") {
      return undefined;
    }
    if (hasOwn(rawBlock, "data") && rawBlock.data !== undefined && typeof rawBlock.data !== "string") {
      return undefined;
    }
    if (hasOwn(rawBlock, "mimeType") && rawBlock.mimeType !== undefined && typeof rawBlock.mimeType !== "string") {
      return undefined;
    }
  }

  return value.isError;
}

const SUCCESSFUL_RESULT: ToolResultSnapshot = Object.freeze({
  content: Object.freeze([]),
  isError: false,
});

const FAILED_RESULT: ToolResultSnapshot = Object.freeze({
  content: Object.freeze([]),
  isError: true,
});

const MAX_ERROR_SUMMARY_CODE_POINTS = 512;

function minimalResult(isError: boolean): ToolResultSnapshot {
  return isError ? FAILED_RESULT : SUCCESSFUL_RESULT;
}

function extractErrorSummary(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.content)) return undefined;

  let lastLine: string | undefined;
  for (const rawBlock of value.content) {
    if (!isRecord(rawBlock) || typeof rawBlock.text !== "string") continue;
    for (const rawLine of rawBlock.text.split(/\r?\n|\r/u)) {
      const line = sanitizeDisplay(rawLine);
      if (line.length > 0) lastLine = line;
    }
  }

  if (lastLine === undefined) return undefined;
  return Array.from(lastLine).slice(0, MAX_ERROR_SUMMARY_CODE_POINTS).join("");
}

type EditSummaryArgs = {
  readonly path: string;
  readonly replacementCount?: number;
};

type WriteSummaryArgs = {
  readonly path: string;
};

function summarizeEditPath(value: unknown): EditSummaryArgs | undefined {
  if (!isRecord(value) || typeof value.path !== "string" || value.path.length === 0) {
    return undefined;
  }
  return Object.freeze({ path: value.path });
}

function summarizeEditArgs(value: unknown): EditSummaryArgs | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["path", "edits"]) ||
    typeof value.path !== "string" ||
    value.path.length === 0 ||
    !Array.isArray(value.edits)
  ) {
    return undefined;
  }

  // Inspect only the shape and count. Never retain oldText/newText references.
  for (const edit of value.edits) {
    if (
      !isRecord(edit) ||
      !hasOnlyKnownKeys(edit, ["oldText", "newText"]) ||
      typeof edit.oldText !== "string" ||
      typeof edit.newText !== "string"
    ) {
      return undefined;
    }
  }

  return Object.freeze({
    path: value.path,
    replacementCount: value.edits.length,
  });
}

function summarizeWritePath(value: unknown): WriteSummaryArgs | undefined {
  if (!isRecord(value) || typeof value.path !== "string" || value.path.length === 0) {
    return undefined;
  }
  // A write snapshot never retains content, even when the call fails.
  return Object.freeze({ path: value.path });
}

function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && value.length > 0;
}

/**
 * Pi's shell renderer stores its timing state in rendererState. Read it only
 * when it is present and valid; never invent a duration for tools that do not
 * expose one.
 */
function elapsedFromPiState(value: unknown): number | undefined {
  if (!isRecord(value) || typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt)) {
    return undefined;
  }

  let end = Date.now();
  if (hasOwn(value, "endedAt")) {
    if (typeof value.endedAt !== "number" || !Number.isFinite(value.endedAt)) return undefined;
    end = value.endedAt;
  }

  const elapsed = end - value.startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : undefined;
}

function inspectToolRow(row: unknown): CandidateClassification | undefined {
  if (!(row instanceof ToolExecutionComponent)) return undefined;
  if (!isRecord(row)) return undefined;
  const fields = row as unknown as Record<string, unknown>;

  // These are private implementation fields in Pi 0.85.x. Keep all access in
  // this function so a field change makes the row native rather than guessed.
  if (
    !hasOwn(fields, "toolName") ||
    !hasOwn(fields, "args") ||
    !hasOwn(fields, "result") ||
    !hasOwn(fields, "isPartial") ||
    !hasOwn(fields, "expanded") ||
    !isToolName(fields.toolName) ||
    typeof fields.isPartial !== "boolean" ||
    typeof fields.expanded !== "boolean"
  ) {
    return undefined;
  }

  const kind = groupKindForTool(fields.toolName);
  if (kind === undefined) return undefined;

  const toolCallId = fields.toolCallId;
  if (toolCallId !== undefined && (!isToolName(toolCallId))) return undefined;

  const resultError = fields.result === undefined ? undefined : resultErrorState(fields.result);
  if (fields.result !== undefined && resultError === undefined) return undefined;

  // Expanded rows remain native. Image results may use the compact path/status
  // summary while collapsed; expanded mode still delegates to Pi's native image
  // renderer. Failed rows use a minimal status result and error summary rather
  // than copying their complete output or details.
  if (fields.expanded) return undefined;

  if (kind === "edit") {
    // Pi's edit renderer can show a preview diff while execution is pending.
    // Keep that native preview intact. Once the final result settles, retain
    // only the path/count projection and, on failure, one generic error line.
    if (fields.isPartial || fields.result === undefined) return undefined;

    const args = resultError === true
      ? summarizeEditArgs(fields.args) ?? summarizeEditPath(fields.args)
      : summarizeEditArgs(fields.args);
    if (resultError === false && args === undefined) return undefined;

    const snapshot: ToolRowSnapshot = Object.freeze({
      toolName: fields.toolName,
      args,
      result: minimalResult(resultError === true),
      errorSummary: resultError === true ? extractErrorSummary(fields.result) : undefined,
      isPartial: false,
      expanded: false,
    });
    return {
      kind,
      snapshot,
      ...(toolCallId === undefined ? {} : { toolCallId }),
    };
  }

  const args = fields.toolName === "write"
    ? summarizeWritePath(fields.args)
    : copySnapshot(fields.args);
  if (fields.toolName === "write" && args === undefined) {
    // A failed write can still be grouped without exposing malformed content;
    // a successful write needs a safe destination path.
    if (resultError !== true) return undefined;
  }

  const elapsedMs = kind === "command" ? elapsedFromPiState(fields.rendererState) : undefined;
  const snapshot: ToolRowSnapshot = Object.freeze({
    toolName: fields.toolName,
    args,
    result: fields.result === undefined ? undefined : minimalResult(resultError === true),
    errorSummary: resultError === true ? extractErrorSummary(fields.result) : undefined,
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
    isPartial: fields.isPartial,
    expanded: fields.expanded,
  });

  return {
    kind,
    snapshot,
    ...(toolCallId === undefined ? {} : { toolCallId }),
  };
}

function isAssistant(row: unknown): row is AssistantMessageComponent {
  return typeof AssistantMessageComponent === "function" && row instanceof AssistantMessageComponent;
}

/**
 * Read only the assistant metadata needed by the pure Story Spine model. Raw
 * thinking, tool arguments, signatures, and results never leave this adapter.
 * The source-order references deliberately retain only content kinds, indexes,
 * and tool-call IDs.
 */
function inspectAssistantMetadata(row: unknown): AssistantMetadata | undefined {
  if (!isAssistant(row) || !isRecord(row)) return undefined;
  const fields = row as unknown as Record<string, unknown>;
  const message = fields.lastMessage;
  if (
    !isRecord(message) ||
    message.role !== "assistant" ||
    !Array.isArray(message.content) ||
    typeof message.stopReason !== "string" ||
    typeof fields.isStreaming !== "boolean"
  ) {
    return undefined;
  }

  const expectedToolCallIds: string[] = [];
  const contentKinds: AssistantContentKind[] = [];
  const sourceOrder: StoryboardSourceItem[] = [];
  let hasThinking = false;
  let hasText = false;
  let hasVisibleContent = false;

  const addAssistantContent = (kind: AssistantContentKind): void => {
    const contentIndex = contentKinds.length;
    contentKinds.push(kind);
    sourceOrder.push({ type: "assistant", contentIndex });
  };

  for (let index = 0; index < message.content.length; index++) {
    const rawBlock = message.content[index];
    if (!isRecord(rawBlock) || typeof rawBlock.type !== "string") return undefined;
    if (rawBlock.type === "text") {
      if (typeof rawBlock.text !== "string") return undefined;
      if (rawBlock.text.trim().length > 0) {
        hasText = true;
        hasVisibleContent = true;
        addAssistantContent("text");
      }
    } else if (rawBlock.type === "thinking") {
      const thinkingBlocks: string[] = [];
      for (; index < message.content.length; index++) {
        const thinkingContent = message.content[index];
        if (!isRecord(thinkingContent) || thinkingContent.type !== "thinking") break;
        if (typeof thinkingContent.thinking !== "string") return undefined;
        if (thinkingContent.thinking.trim().length > 0) thinkingBlocks.push(thinkingContent.thinking);
      }
      index--;
      if (thinkingBlocks.length > 0) {
        hasThinking = true;
        hasVisibleContent = true;
        addAssistantContent("thinking");

        // This is the native AssistantMessageComponent spacer policy: it
        // depends only on later visible assistant content, not on tool calls.
        const hasVisibleContentAfter = message.content
          .slice(index + 1)
          .some((content) =>
            isRecord(content) &&
            ((content.type === "text" && typeof content.text === "string" && content.text.trim().length > 0) ||
              (content.type === "thinking" && typeof content.thinking === "string" && content.thinking.trim().length > 0)),
          );
        if (hasVisibleContentAfter) addAssistantContent("native");
      }
    } else if (rawBlock.type === "toolCall") {
      if (!isToolName(rawBlock.id)) return undefined;
      expectedToolCallIds.push(rawBlock.id);
      sourceOrder.push({ type: "tool", toolCallId: rawBlock.id });
    } else {
      return undefined;
    }
  }

  return Object.freeze({
    assistantRow: row,
    expectedToolCallIds: Object.freeze(expectedToolCallIds),
    stopReason: message.stopReason,
    isStreaming: fields.isStreaming,
    hasThinking,
    hasText,
    contentKinds: Object.freeze(contentKinds),
    sourceOrder: Object.freeze(sourceOrder),
    hasVisibleContent,
  });
}

/**
 * Reuse the actual native content children after Pi has rendered the
 * AssistantMessageComponent. This is the only additional private shape we
 * inspect: it lets the presentation wrapper move MouseRegion/Markdown
 * children around tool groups without recreating Markdown or thinking text.
 */
function inspectAssistantPresentation(
  row: AssistantMessageComponent,
  metadata: AssistantMetadata,
  width: number,
  renderedAssistantLines: readonly string[],
): AssistantPresentation | undefined | null {
  if (!isRecord(row)) return undefined;
  const fields = row as unknown as Record<string, unknown>;
  // Test doubles and older compatible shapes may not expose the child
  // container. They retain the established whole-assistant fallback path.
  if (!hasOwn(fields, "contentContainer")) return null;
  const contentContainer = fields.contentContainer;
  if (!isRecord(contentContainer) || !Array.isArray(contentContainer.children)) return undefined;
  const layout = contentContainer.mouseLayout;
  if (
    !isRecord(layout) ||
    layout.width !== width ||
    !Array.isArray(layout.children) ||
    layout.children.length !== contentContainer.children.length
  ) return undefined;

  const children = contentContainer.children as unknown[];
  const layoutChildren = layout.children as unknown[];
  let childCursor = 0;
  let lineCursor = 0;
  const parts: StoryboardAssistantContent[] = [];

  const consumeChild = (): { child: unknown; lines: string[] } | undefined => {
    const child = children[childCursor];
    const layoutEntry = layoutChildren[childCursor];
    childCursor++;
    if (!child || !isRecord(layoutEntry) || layoutEntry.component !== child) return undefined;
    if (typeof layoutEntry.height !== "number" || !Number.isSafeInteger(layoutEntry.height) || layoutEntry.height < 0) {
      return undefined;
    }
    const end = lineCursor + layoutEntry.height;
    if (end > renderedAssistantLines.length) return undefined;
    const lines = [...renderedAssistantLines.slice(lineCursor, end)];
    lineCursor = end;
    return { child, lines };
  };

  // A visible assistant message starts with exactly one native Spacer(1).
  // Diagnostic-only messages do not have this leading spacer.
  if (metadata.hasVisibleContent) {
    const leading = consumeChild();
    if (leading === undefined || leading.lines.some((line) => visibleWidth(line) !== 0)) return undefined;
  }

  for (const kind of metadata.contentKinds) {
    const consumed = consumeChild();
    if (consumed === undefined) return undefined;
    parts.push(Object.freeze({
      type: kind,
      row: consumed.child,
      renderedLines: Object.freeze(consumed.lines),
    }));
  }

  // Pi appends length/abort/error diagnostics after the content children. They
  // are not message.content items, but retaining them as native parts keeps
  // native diagnostics visible in an ordered scene.
  while (childCursor < children.length) {
    const consumed = consumeChild();
    if (consumed === undefined) return undefined;
    parts.push(Object.freeze({
      type: "native",
      row: consumed.child,
      renderedLines: Object.freeze(consumed.lines),
    }));
  }

  return lineCursor === renderedAssistantLines.length ? { parts: Object.freeze(parts) } : undefined;
}

function withAssistantLines(
  metadata: AssistantMetadata,
  renderedAssistantLines: readonly string[],
  presentation?: AssistantPresentation,
): AssistantSceneSnapshot {
  const base = {
    assistantRow: metadata.assistantRow,
    renderedAssistantLines: Object.freeze([...renderedAssistantLines]),
    expectedToolCallIds: metadata.expectedToolCallIds,
    stopReason: metadata.stopReason,
    isStreaming: metadata.isStreaming,
    hasThinking: metadata.hasThinking,
    hasText: metadata.hasText,
  };
  if (presentation === undefined) return Object.freeze(base);

  const assistantContent = presentation.parts;
  const sourceOrder = [...metadata.sourceOrder];
  for (let index = metadata.contentKinds.length; index < assistantContent.length; index++) {
    sourceOrder.push({ type: "assistant", contentIndex: index });
  }
  return Object.freeze({
    ...base,
    assistantContent,
    sourceOrder: Object.freeze(sourceOrder),
  });
}

function nativeClassification(row: unknown): ChildClassification {
  return { type: "native", row };
}

function candidateClassification(row: unknown, candidate: CandidateClassification): ChildClassification {
  return { type: "candidate", kind: candidate.kind, row };
}

function invisibleClassification(row: unknown): ChildClassification {
  return { type: "invisible", row };
}

/**
 * A scene occupies one mouse-layout entry. Header and thinking clicks are
 * translated back to the exact native assistant child that produced them;
 * rails, separators, and grouped summaries are presentation-only.
 */
class StoryboardSceneMouseProxy implements Component {
  constructor(
    private readonly assistant: Component,
    private readonly assistantWidth: number,
    private readonly assistantHeight: number,
    private readonly prefixWidth: number,
    private readonly regions: readonly StoryboardAssistantRenderRegion[] = [],
  ) {}

  render(_width: number): string[] {
    return [];
  }

  invalidate(): void {}

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const region = this.regions.find(
      (candidate) => event.y >= candidate.start && event.y < candidate.start + candidate.height,
    );
    if (region !== undefined) {
      const regionWidth = Math.max(1, event.width - region.prefixWidth);
      if (
        event.x < region.prefixWidth ||
        event.x >= region.prefixWidth + regionWidth
      ) {
        return { handled: true };
      }
      const result = (region.row as Component).handleMouse?.({
        ...event,
        x: event.x - region.prefixWidth,
        y: event.y - region.start,
        width: regionWidth,
        height: region.height,
      });
      return result ?? { handled: true };
    }

    // Ordered scenes have explicit regions for every native assistant child.
    // Never feed a rail or grouped-tool coordinate to the original assistant,
    // whose private mouse layout still reflects the unprojected component.
    if (this.regions.length > 0) return { handled: true };

    if (
      event.y < 0 ||
      event.y >= this.assistantHeight ||
      event.x < this.prefixWidth ||
      event.x >= this.prefixWidth + this.assistantWidth
    ) {
      return { handled: true };
    }

    const result = this.assistant.handleMouse?.({
      ...event,
      x: event.x - this.prefixWidth,
      width: this.assistantWidth,
      height: this.assistantHeight,
    });
    return result ?? { handled: true };
  }
}

function validRenderedLines(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((line) => typeof line === "string");
}

function invokeOriginal(container: Container, state: PatchState, width: number): string[] {
  return state.original.call(container, width);
}

type StoryboardAttempt = {
  requested: boolean;
  output?: string[];
};

function componentForStoryboardChild(child: StoryboardChild): Component | undefined {
  const row = child.type === "assistant"
    ? child.assistant.assistantRow
    : child.type === "tool"
      ? child.tool.toolRow
      : child.row;
  if (!row || typeof (row as Component).render !== "function") return undefined;
  return row as Component;
}

function makeStoryboardChild(
  child: Component,
  metadata: Map<AssistantMessageComponent, AssistantMetadata>,
  snapshots: Map<AssistantMessageComponent, AssistantSceneSnapshot>,
  candidates: Map<ToolExecutionComponent, CandidateClassification>,
): StoryboardChild {
  if (isAssistant(child)) {
    const snapshot = snapshots.get(child);
    if (snapshot !== undefined) return { type: "assistant", assistant: snapshot };
    const assistant = metadata.get(child);
    if (assistant !== undefined) return { type: "assistant", assistant: withAssistantLines(assistant, []) };
    return { type: "native", row: child };
  }

  if (child instanceof ToolExecutionComponent) {
    const candidate = candidates.get(child);
    if (candidate?.toolCallId !== undefined) {
      return {
        type: "tool",
        tool: {
          toolRow: child,
          toolCallId: candidate.toolCallId,
          kind: candidate.kind,
          snapshot: candidate.snapshot,
        },
      };
    }
  }
  return { type: "native", row: child };
}

/**
 * Attempt the Story Spine projection independently from the legacy grouping
 * path. Returning `requested: false` keeps existing tool-only containers and
 * older/incomplete assistant shapes on their unchanged baseline behavior.
 */
function renderStoryboardIfRequested(
  container: Container,
  width: number,
  options: ToolGroupingPatchOptions,
): StoryboardAttempt {
  const children = container.children.slice();
  if (children.length === 0) return { requested: false };

  const candidates = new Map<ToolExecutionComponent, CandidateClassification>();
  const metadata = new Map<AssistantMessageComponent, AssistantMetadata>();
  for (const child of children) {
    if (child instanceof ToolExecutionComponent) {
      const candidate = inspectToolRow(child);
      if (candidate !== undefined) candidates.set(child, candidate);
    } else if (isAssistant(child)) {
      const assistant = inspectAssistantMetadata(child);
      if (assistant !== undefined) metadata.set(child, assistant);
    }
  }

  const storyboardRequested = [...metadata.values()].some(
    (assistant) => assistant.expectedToolCallIds.length > 0 || (assistant.hasThinking && !assistant.hasText),
  );
  if (!storyboardRequested) return { requested: false };

  const preSnapshots = new Map<AssistantMessageComponent, AssistantSceneSnapshot>();
  for (const [assistant, assistantMetadata] of metadata) {
    preSnapshots.set(assistant, withAssistantLines(assistantMetadata, []));
  }
  const preChildren = children.map((child) => makeStoryboardChild(child, metadata, preSnapshots, candidates));
  const preProjection = buildStoryboard(preChildren);
  const sceneOwners = new Set<unknown>();
  for (const segment of preProjection.segments) {
    if (segment.type === "scene") sceneOwners.add(segment.assistant.assistantRow);
  }

  const nativeLines = new Map<Component, string[]>();
  const assistantSnapshots = new Map<AssistantMessageComponent, AssistantSceneSnapshot>();
  const safeWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  for (const child of children) {
    if (child instanceof ToolExecutionComponent) continue;
    if (!child || typeof child.render !== "function") return { requested: true };
    const assistantMetadata = isAssistant(child) ? metadata.get(child) : undefined;
    const renderWidth = assistantMetadata !== undefined && sceneOwners.has(child)
      ? storyboardAssistantWidth(safeWidth)
      : safeWidth;
    const lines = child.render(renderWidth);
    if (!validRenderedLines(lines)) return { requested: true };
    nativeLines.set(child, lines);
    if (isAssistant(child) && assistantMetadata !== undefined) {
      let presentation: AssistantPresentation | undefined | null;
      if (sceneOwners.has(child)) {
        presentation = inspectAssistantPresentation(child, assistantMetadata, renderWidth, lines);
        if (presentation === undefined) return { requested: true };
      }
      // `null` means that this is an older/test-shaped assistant component
      // without the native content container; retain the established whole
      // assistant fallback for that shape.
      assistantSnapshots.set(child, withAssistantLines(assistantMetadata, lines, presentation ?? undefined));
    }
  }

  const storyboardChildren = children.map((child) => makeStoryboardChild(
    child,
    metadata,
    assistantSnapshots,
    candidates,
  ));
  const projection = buildStoryboard(storyboardChildren);
  const finalSceneOwners = new Set<unknown>();
  for (const segment of projection.segments) {
    if (segment.type === "scene") finalSceneOwners.add(segment.assistant.assistantRow);
  }
  // A scene owner that became incompatible after the native child extraction
  // must not be emitted with the reduced scene width. Re-run Pi's complete
  // container instead of accidentally narrowing a native fallback.
  for (const owner of sceneOwners) {
    if (!finalSceneOwners.has(owner)) return { requested: true };
  }
  const rendered: string[] = [];
  const mouseChildren: Array<{ component: Component; height: number }> = [];
  const theme = options.getTheme();

  const renderNative = (child: StoryboardChild): string[] => {
    const component = componentForStoryboardChild(child);
    if (component === undefined) throw new Error("native storyboard child is not renderable");
    const cached = nativeLines.get(component);
    if (cached !== undefined) return cached;
    const lines = component.render(safeWidth);
    if (!validRenderedLines(lines)) throw new Error("native child returned invalid lines");
    nativeLines.set(component, lines);
    return lines;
  };

  for (const segment of projection.segments) {
    if (segment.type === "scene") {
      const assistant = componentForStoryboardChild({ type: "assistant", assistant: segment.assistant });
      if (assistant === undefined) throw new Error("scene assistant is not renderable");
      const assistantLines = nativeLines.get(assistant);
      if (assistantLines === undefined) throw new Error("scene assistant output missing");
      // Pi's visible assistant component already contributes its native
      // leading Spacer(1). Use that row as the scene boundary instead of
      // adding a second blank row; tool-only assistants have no such native
      // spacer, so provide the preview's one-row boundary for them (and for
      // any compatible component that does not expose one).
      const hasNativeLeadingSpacer =
        assistantLines.length > 0 && visibleWidth(assistantLines[0] ?? "") === 0;
      if (!hasNativeLeadingSpacer) {
        rendered.push("");
        mouseChildren.push({ component: GROUP_MOUSE_SINK, height: 1 });
      }
      const sceneLayout = renderStoryboardSceneLayout(
        segment,
        assistantLines,
        safeWidth,
        theme,
        options.renderGroup,
      );
      const sceneLines = [...sceneLayout.lines];
      rendered.push(...sceneLines);
      mouseChildren.push({
        component: new StoryboardSceneMouseProxy(
          assistant,
          storyboardAssistantWidth(safeWidth),
          assistantLines.length,
          Math.max(0, safeWidth - storyboardAssistantWidth(safeWidth)),
          sceneLayout.assistantRegions,
        ),
        height: sceneLines.length,
      });
      continue;
    }

    for (const child of segment.children) {
      const lines = renderNative(child);
      rendered.push(...lines);
      const component = componentForStoryboardChild(child);
      if (component === undefined) throw new Error("native storyboard child is not renderable");
      mouseChildren.push({ component, height: lines.length });
    }
  }

  setMouseLayout(container, safeWidth, mouseChildren);
  return { requested: true, output: rendered };
}

function renderPatched(
  this: Container,
  width: number,
  state: PatchState,
): string[] {
  const options = state.options;
  if (!state.enabled || options === undefined) return invokeOriginal(this, state, width);

  try {
    const storyboard = renderStoryboardIfRequested(this, width, options);
    if (storyboard.requested) {
      return storyboard.output ?? invokeOriginal(this, state, width);
    }
  } catch {
    // Story Spine is an optional presentation layer. Any incompatible shape or
    // renderer failure leaves the complete container native.
    return invokeOriginal(this, state, width);
  }

  let fallback = false;
  let output: string[] | undefined;

  try {
    const children = this.children.slice();
    if (children.length === 0) {
      fallback = true;
    } else {
      const classifications: ChildClassification[] = [];
      // The grouping core sees immutable snapshots, never live Pi rows. This
      // reverse map is only needed when a singleton candidate must be rendered
      // natively after segmentation.
      const candidates = new Map<ToolRowSnapshot, ToolExecutionComponent>();
      let candidateCount = 0;

      for (const child of children) {
        const candidate = inspectToolRow(child);
        if (candidate?.snapshot !== undefined) {
          classifications.push(candidateClassification(candidate.snapshot, candidate));
          candidates.set(candidate.snapshot, child as ToolExecutionComponent);
          candidateCount++;
        } else if (child instanceof ToolExecutionComponent) {
          // A recognized class with an unexpected private shape is a hard native
          // boundary, not an opportunity to infer a newer shape.
          classifications.push(nativeClassification(child));
        } else {
          // Filled in below after the component is rendered once. This keeps an
          // empty AssistantMessageComponent from breaking visual adjacency.
          classifications.push(nativeClassification(child));
        }
      }

      // At least one eligible row is enough for a compact group. This keeps
      // singleton reads/searches/lists on the same presentation as batches.
      if (candidateCount === 0) {
        fallback = true;
      } else {
        const nativeLines = new Map<unknown, string[]>();
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child instanceof ToolExecutionComponent) continue;

          if (!child || typeof (child as Component).render !== "function") {
            fallback = true;
            break;
          }
          const lines = (child as Component).render(width);
          if (!validRenderedLines(lines)) {
            fallback = true;
            break;
          }
          nativeLines.set(child, lines);

          if (isAssistant(child) && lines.length === 0) {
            classifications[i] = invisibleClassification(child);
          }
        }

        if (!fallback) {
          const segments = segmentChildren(classifications);

          // Render custom groups before rendering any native tool row. If theme
          // or group rendering has drifted, the fallback can still be entirely
          // native.
          const groupLines = new Map<Segment, string[]>();
          const groupedTools = new Set<ToolExecutionComponent>();
          const groupAnchors = new Map<ToolExecutionComponent, number>();
          for (const segment of segments) {
            if (segment.type !== "group") continue;
            const rows: ToolRowSnapshot[] = [];
            const members: ToolExecutionComponent[] = [];
            for (const row of segment.rows) {
              const member = candidates.get(row as ToolRowSnapshot);
              if (!member) throw new Error("group member snapshot missing");
              rows.push(row as ToolRowSnapshot);
              members.push(member);
              groupedTools.add(member);
            }
            const group: GroupSnapshot = Object.freeze({
              kind: segment.kind,
              rows: Object.freeze(rows),
            });
            const lines = options.renderGroup(group, width, options.getTheme());
            if (!validRenderedLines(lines)) throw new Error("group renderer returned invalid lines");
            groupLines.set(segment, lines);
            const anchor = members[0];
            if (!anchor) throw new Error("group has no members");
            groupAnchors.set(anchor, lines.length);
          }

          const rendered: string[] = [];
          for (const segment of segments) {
            if (segment.type === "group") {
              rendered.push(...(groupLines.get(segment) ?? []));
              continue;
            }

            const candidate = candidates.get(segment.row as ToolRowSnapshot);
            const component = candidate ?? (segment.row as Component);
            if (!component || typeof component.render !== "function") {
              throw new Error("native child is not renderable");
            }

            // Reuse the one native render performed during this pass. This is
            // important for live components with renderer state or caches.
            if (nativeLines.has(component)) {
              rendered.push(...nativeLines.get(component)!);
              continue;
            }

            const nativeOutput = component.render(width);
            if (!validRenderedLines(nativeOutput)) {
              throw new Error("native child returned invalid lines");
            }
            nativeLines.set(component, nativeOutput);
            rendered.push(...nativeOutput);
          }

          // Keep Container.handleMouse's coordinates consistent with the
          // grouped visual output. Group members receive zero height except
          // for a presentation-only sink at the first member's position.
          const mouseChildren: Array<{ component: Component; height: number }> = [];
          for (const child of children) {
            if (child instanceof ToolExecutionComponent && groupedTools.has(child)) {
              const groupHeight = groupAnchors.get(child);
              mouseChildren.push(
                groupHeight === undefined
                  ? { component: child, height: 0 }
                  : { component: GROUP_MOUSE_SINK, height: groupHeight },
              );
              continue;
            }
            const lines = nativeLines.get(child);
            if (lines === undefined) throw new Error("native child output missing");
            mouseChildren.push({ component: child, height: lines.length });
          }
          setMouseLayout(this, width, mouseChildren);
          output = rendered;
        }
      }
    }
  } catch {
    fallback = true;
  }

  // Keep calls to the original renderer outside the protected block. If Pi's
  // own renderer throws, do not invoke it a second time.
  return fallback || output === undefined ? invokeOriginal(this, state, width) : output;
}

function getPatchState(prototype: object): PatchState | undefined {
  const value = (prototype as Record<PropertyKey, unknown>)[PATCH_MARKER];
  if (!isRecord(value)) return undefined;
  if (
    typeof value.original !== "function" ||
    typeof value.wrapper !== "function" ||
    typeof value.originalDescriptor !== "object" ||
    typeof value.owners !== "number" ||
    typeof value.enabled !== "boolean"
  ) {
    return undefined;
  }
  return value as unknown as PatchState;
}

function canConstruct(value: unknown): value is new (...args: never[]) => unknown {
  if (typeof value !== "function" || !value.prototype) return false;
  try {
    // Use Object as the target so feature detection does not instantiate the
    // component or run any UI code.
    Reflect.construct(Object, [], value);
    return true;
  } catch {
    return false;
  }
}

function makeHandle(
  prototype: object,
  state: PatchState,
): PatchHandle {
  let uninstalled = false;
  return {
    uninstall(): void {
      if (uninstalled) return;
      uninstalled = true;
      if (state.owners > 0) state.owners--;
      if (state.owners !== 0) return;

      state.enabled = false;
      state.options = undefined;

      // A different extension may have wrapped or replaced us since install.
      // Never restore over that newer function.
      let canRemoveMarker = (prototype as { render?: unknown }).render !== state.wrapper;
      if (!canRemoveMarker) {
        try {
          Object.defineProperty(prototype, "render", state.originalDescriptor);
          canRemoveMarker = (prototype as { render?: unknown }).render !== state.wrapper;
        } catch {
          // Keep the disabled marker if restoration is impossible. That avoids
          // stacking another copy of this already-installed wrapper later.
        }
      }

      const markerValue = (prototype as Record<PropertyKey, unknown>)[PATCH_MARKER];
      if (canRemoveMarker && markerValue === state) {
        try {
          delete (prototype as Record<PropertyKey, unknown>)[PATCH_MARKER];
        } catch {
          // A non-configurable marker is harmless after the wrapper is disabled.
        }
      }
    },
  };
}

/**
 * Install the one private-API seam used by the extension. Any incompatible
 * shape returns undefined and leaves Pi's prototype untouched.
 */
export function installToolGroupingPatch(
  options: ToolGroupingPatchOptions,
): PatchHandle | undefined {
  let createdState: PatchState | undefined;
  try {
    if (
      !options ||
      typeof options.getTheme !== "function" ||
      typeof options.renderGroup !== "function"
    ) {
      return undefined;
    }

    const prototype = Container?.prototype;
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "render") : undefined;
    const original = descriptor?.value;
    if (!prototype || descriptor === undefined || typeof original !== "function" || !canConstruct(ToolExecutionComponent)) {
      return undefined;
    }

    const existing = getPatchState(prototype);
    if (existing !== undefined) {
      if (existing.wrapper !== (prototype as { render?: unknown }).render || !existing.enabled) {
        return undefined;
      }
      existing.owners++;
      existing.options = options;
      return makeHandle(prototype, existing);
    }

    // An unrelated marker is treated as an incompatibility rather than being
    // overwritten.
    if (Object.getOwnPropertyDescriptor(prototype, PATCH_MARKER) !== undefined) {
      return undefined;
    }

    let state!: PatchState;
    const wrapper: ContainerRender = function (this: Container, width: number): string[] {
      return renderPatched.call(this, width, state);
    };
    state = {
      original: original as ContainerRender,
      originalDescriptor: descriptor,
      wrapper,
      owners: 1,
      enabled: true,
      options,
    };

    createdState = state;
    Object.defineProperty(prototype, PATCH_MARKER, {
      configurable: true,
      enumerable: false,
      value: state,
      writable: false,
    });
    Object.defineProperty(prototype, "render", { ...descriptor, value: wrapper });
    return makeHandle(prototype, state);
  } catch {
    // If installing the wrapper itself failed after the marker was created,
    // remove only our marker and leave the native prototype untouched.
    if (createdState) {
      const prototype = Container?.prototype;
      if (
        prototype &&
        (prototype as unknown as Record<PropertyKey, unknown>)[PATCH_MARKER] === createdState
      ) {
        try {
          delete (prototype as unknown as Record<PropertyKey, unknown>)[PATCH_MARKER];
        } catch {
          // There is no safe mutation left to make.
        }
      }
    }
    return undefined;
  }
}

/** Exposed for adapter-focused tests without exposing Pi's private field names elsewhere. */
export function classifyToolRowForTesting(row: unknown): ToolRowSnapshot | undefined {
  return inspectToolRow(row)?.snapshot;
}
