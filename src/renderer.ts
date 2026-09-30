import {
  sliceByColumn,
  Spacer,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { GroupKind } from "./grouping.ts";
import { sanitizeDisplay } from "./safe-display.ts";
import {
  DEFAULT_PRESENTATION_SETTINGS,
  type PresentationSettings,
  type StoryboardColorName,
  type TrimMode,
} from "./presentation-settings.ts";
export { sanitizeDisplay } from "./safe-display.ts";

/** Pi tool names are open-ended because extensions can add custom tools. */
export type ToolName = string;

export type ResultContentBlock = {
  readonly type: string;
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
};

export type ToolResultSnapshot = {
  readonly content: readonly ResultContentBlock[];
  readonly details?: unknown;
  readonly isError: boolean;
};

/** The immutable, display-only view of a native tool row. */
export type ToolRowSnapshot = {
  readonly toolName: ToolName;
  readonly args: unknown;
  readonly result?: ToolResultSnapshot;
  /** Bounded, generic text extracted from a failed result; full output is never copied. */
  readonly errorSummary?: string;
  /** Pi's shell renderer timing, when it exposes a valid start/end clock. */
  readonly elapsedMs?: number;
  readonly isPartial: boolean;
  readonly expanded: boolean;
};

export type GroupSnapshot = {
  readonly kind: GroupKind;
  readonly rows: readonly ToolRowSnapshot[];
  /** Bounded presentation-only detail lines aligned with their real tool rows. */
  readonly rowDetails?: readonly (readonly string[] | undefined)[];
};

export interface ThemeLike {
  fg(color: StoryboardColorName, text: string): string;
  bold?(text: string): string;
  italic?(text: string): string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validOptionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined | null {
  if (!hasOwn(args, key)) return undefined;
  return typeof args[key] === "string" ? args[key] : null;
}

function validOptionalNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined | null {
  if (!hasOwn(args, key)) return undefined;
  return typeof args[key] === "number" && Number.isFinite(args[key]) ? args[key] : null;
}

function validOptionalBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined | null {
  if (!hasOwn(args, key)) return undefined;
  return typeof args[key] === "boolean" ? args[key] : null;
}

function hasOnlyKnownKeys(args: Record<string, unknown>, keys: readonly string[]): boolean {
  const known = new Set(keys);
  return Object.keys(args).every((key) => known.has(key));
}

function compactJson(value: unknown): string {
  try {
    const result = JSON.stringify(value);
    return sanitizeDisplay(result === undefined ? String(value) : result);
  } catch {
    return "[unserializable arguments]";
  }
}

function quote(value: string): string {
  return JSON.stringify(sanitizeDisplay(value));
}

function numberText(value: number): string {
  return sanitizeDisplay(String(value));
}

type ToolRowParts = {
  /** Untrimmed text before the path-like main value, used by search labels. */
  readonly mainPrefix?: string;
  readonly main: string;
  readonly detail?: string;
  readonly mainTrim?: "fileNames" | "commands" | "tools";
  /** Recognized tool arguments were malformed, so the caller must show the tool name. */
  readonly fallback?: boolean;
};

function fallbackParts(args: unknown): ToolRowParts {
  return { main: compactJson(args), fallback: true };
}

function formatReadParts(args: unknown): ToolRowParts {
  if (
    !isRecord(args) ||
    !hasOnlyKnownKeys(args, ["path", "offset", "limit"]) ||
    typeof args.path !== "string" ||
    args.path.length === 0
  ) {
    return fallbackParts(args);
  }

  const offset = validOptionalNumber(args, "offset");
  const limit = validOptionalNumber(args, "limit");
  if (offset === null || limit === null) return fallbackParts(args);

  const range: string[] = [];
  if (offset !== undefined) range.push(`offset=${numberText(offset)}`);
  if (limit !== undefined) range.push(`limit=${numberText(limit)}`);
  return {
    main: sanitizeDisplay(args.path),
    mainTrim: "fileNames",
    detail: range.length > 0 ? ` (${range.join(", ")})` : undefined,
  };
}

function formatGrepParts(args: unknown): ToolRowParts {
  if (
    !isRecord(args) ||
    !hasOnlyKnownKeys(args, [
      "pattern",
      "path",
      "glob",
      "ignoreCase",
      "literal",
      "context",
      "limit",
    ]) ||
    typeof args.pattern !== "string" ||
    args.pattern.length === 0
  ) {
    return fallbackParts(args);
  }

  const path = validOptionalString(args, "path");
  const glob = validOptionalString(args, "glob");
  const optionalValidity = [
    path,
    glob,
    validOptionalBoolean(args, "ignoreCase"),
    validOptionalBoolean(args, "literal"),
    validOptionalNumber(args, "context"),
    validOptionalNumber(args, "limit"),
  ];
  if (optionalValidity.some((value) => value === null)) return fallbackParts(args);
  const safePath = path === null ? undefined : path === "" ? "." : path;
  const safeGlob = glob as string | undefined;
  const limit = optionalValidity[5] as number | undefined;

  const options: string[] = [];
  if (safeGlob !== undefined) options.push(`glob ${quote(safeGlob)}`);
  if (limit !== undefined) options.push(`limit ${numberText(limit)}`);
  const detail = options.length > 0 ? ` (${options.join(", ")})` : undefined;
  if (safePath === undefined) {
    return {
      main: `grep ${quote(args.pattern)}`,
      detail,
    };
  }
  return {
    mainPrefix: `grep ${quote(args.pattern)} in `,
    main: sanitizeDisplay(safePath),
    mainTrim: "fileNames",
    detail,
  };
}

function formatFindParts(args: unknown): ToolRowParts {
  if (
    !isRecord(args) ||
    !hasOnlyKnownKeys(args, ["pattern", "path", "limit"]) ||
    typeof args.pattern !== "string" ||
    args.pattern.length === 0
  ) {
    return fallbackParts(args);
  }

  const path = validOptionalString(args, "path");
  const limit = validOptionalNumber(args, "limit");
  if (path === null || limit === null) return fallbackParts(args);

  const detail = limit === undefined ? undefined : ` (limit ${numberText(limit)})`;
  if (path === undefined) {
    return { main: `find ${quote(args.pattern)}`, detail };
  }
  return {
    mainPrefix: `find ${quote(args.pattern)} in `,
    main: sanitizeDisplay(path === "" ? "." : path),
    mainTrim: "fileNames",
    detail,
  };
}

function formatLsParts(args: unknown): ToolRowParts {
  if (!isRecord(args) || !hasOnlyKnownKeys(args, ["path", "limit"])) {
    return fallbackParts(args);
  }

  const path = validOptionalString(args, "path");
  const limit = validOptionalNumber(args, "limit");
  if (path === null || limit === null) return fallbackParts(args);

  // Pi's native ls treats an omitted or empty path as the current directory.
  return {
    main: sanitizeDisplay(path === undefined || path === "" ? "." : path),
    mainTrim: "fileNames",
    detail: limit === undefined ? undefined : ` (limit ${numberText(limit)})`,
  };
}

function formatWriteParts(args: unknown): ToolRowParts {
  if (
    isRecord(args) &&
    hasOnlyKnownKeys(args, ["path"]) &&
    typeof args.path === "string" &&
    args.path.length > 0
  ) {
    return { main: sanitizeDisplay(args.path), mainTrim: "fileNames" };
  }
  if (
    !isRecord(args) ||
    !hasOnlyKnownKeys(args, ["path", "content"]) ||
    typeof args.path !== "string" ||
    args.path.length === 0 ||
    typeof args.content !== "string"
  ) {
    return fallbackParts(args);
  }

  // Never display the content being written.
  return { main: sanitizeDisplay(args.path), mainTrim: "fileNames" };
}

function formatEditParts(args: unknown): ToolRowParts {
  // Pending edits may not have streamed a valid path yet. Keep their compact
  // row generic instead of exposing partial edit arguments or showing
  // `undefined` as if it were meaningful tool input.
  if (args === undefined) return { main: "edit" };

  if (
    isRecord(args) &&
    hasOnlyKnownKeys(args, ["path"]) &&
    typeof args.path === "string" &&
    args.path.length > 0
  ) {
    return { main: sanitizeDisplay(args.path), mainTrim: "fileNames" };
  }
  if (
    !isRecord(args) ||
    !hasOnlyKnownKeys(args, ["path", "replacementCount"]) ||
    typeof args.path !== "string" ||
    args.path.length === 0 ||
    typeof args.replacementCount !== "number" ||
    !Number.isSafeInteger(args.replacementCount) ||
    args.replacementCount < 0
  ) {
    return fallbackParts(args);
  }

  return {
    main: sanitizeDisplay(args.path),
    mainTrim: "fileNames",
    detail: ` (${args.replacementCount} ${args.replacementCount === 1 ? "replacement" : "replacements"})`,
  };
}

function formatShellParts(args: unknown): ToolRowParts {
  if (
    !isRecord(args) ||
    !hasOnlyKnownKeys(args, ["command", "timeout", "cwd"]) ||
    typeof args.command !== "string" ||
    args.command.length === 0
  ) {
    return fallbackParts(args);
  }

  const timeout = validOptionalNumber(args, "timeout");
  const cwd = validOptionalString(args, "cwd");
  if (timeout === null || cwd === null) return fallbackParts(args);

  const detail = cwd === undefined ? undefined : ` (cwd ${sanitizeDisplay(cwd)})`;
  return {
    main: sanitizeDisplay(args.command),
    mainTrim: "commands",
    detail,
  };
}

function formatGenericParts(row: ToolRowSnapshot): ToolRowParts {
  return {
    mainPrefix: `${sanitizeDisplay(row.toolName)} `,
    main: compactJson(row.args),
    mainTrim: "tools",
  };
}

function formatRowParts(row: ToolRowSnapshot): ToolRowParts {
  switch (row.toolName) {
    case "read":
      return formatReadParts(row.args);
    case "grep":
      return formatGrepParts(row.args);
    case "find":
      return formatFindParts(row.args);
    case "ls":
      return formatLsParts(row.args);
    case "write":
      return formatWriteParts(row.args);
    case "edit":
      return formatEditParts(row.args);
    case "bash":
    case "powershell":
      return formatShellParts(row.args);
    default:
      return formatGenericParts(row);
  }
}

function mainValueForRow(row: ToolRowSnapshot, parts: ToolRowParts): string {
  if (!parts.fallback) return parts.main;
  if (row.result?.isError === true && (row.toolName === "edit" || row.toolName === "write")) {
    // Malformed edit/write arguments must not leak their content into an error
    // summary. The generic error text remains the useful diagnostic.
    return sanitizeDisplay(row.toolName);
  }
  return `${sanitizeDisplay(row.toolName)} ${parts.main}`;
}

function mainTextForRow(row: ToolRowSnapshot, parts: ToolRowParts): string {
  return `${parts.mainPrefix ?? ""}${mainValueForRow(row, parts)}`;
}

const MAX_ERROR_SUMMARY_CODE_POINTS = 512;

function errorText(row: ToolRowSnapshot): string | undefined {
  if (row.result?.isError !== true) return undefined;
  const text = sanitizeDisplay(row.errorSummary ?? "Failed");
  if (text.length === 0) return "Failed";
  return Array.from(text).slice(0, MAX_ERROR_SUMMARY_CODE_POINTS).join("");
}

function elapsedText(row: ToolRowSnapshot): string | undefined {
  if (row.elapsedMs === undefined || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0) {
    return undefined;
  }
  const label = row.result === undefined || row.isPartial ? "elapsed" : "took";
  return `${label} ${(row.elapsedMs / 1000).toFixed(1)}s`;
}

function elapsedDetail(row: ToolRowSnapshot): string {
  const elapsed = elapsedText(row);
  return elapsed === undefined ? "" : ` (${elapsed})`;
}

function formatRow(row: ToolRowSnapshot): string {
  const parts = formatRowParts(row);
  const main = mainTextForRow(row, parts);
  const error = errorText(row);
  return `${main}${parts.detail ?? ""}${elapsedDetail(row)}${error === undefined ? "" : `\n${error}`}`;
}

function heading(kind: GroupKind, count: number): string {
  switch (kind) {
    case "read":
      return `Read ${count} ${count === 1 ? "file" : "files"}`;
    case "search":
      return `Search ${count} ${count === 1 ? "time" : "times"}`;
    case "list":
      return `List ${count} ${count === 1 ? "directory" : "directories"}`;
    case "write":
      return `Write ${count} ${count === 1 ? "file" : "files"}`;
    case "edit":
      return `Edit ${count} ${count === 1 ? "time" : "times"}`;
    case "command":
      return `Run ${count} ${count === 1 ? "command" : "commands"}`;
    case "tool":
      return `Run ${count} ${count === 1 ? "tool" : "tools"}`;
  }
}

function normaliseWidth(width: number): number {
  if (!Number.isFinite(width)) return 0;
  return Math.max(0, Math.floor(width));
}

function fit(line: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateToWidth(line, width);
  // This second check is deliberately cheap insurance for unusual ANSI or
  // grapheme sequences supplied by a theme implementation.
  return visibleWidth(truncated) <= width
    ? truncated
    : truncateToWidth(line, width, "");
}

/**
 * Truncate from the middle so a long path keeps both its leading directories
 * and its filename. The input may contain ANSI styling from the active theme.
 */
function fitMiddle(line: string, width: number): string {
  if (width <= 0 || visibleWidth(line) <= width) return width <= 0 ? "" : line;

  const ellipsis = "...";
  const ellipsisWidth = visibleWidth(ellipsis);
  // At very narrow widths, show the source prefix instead of a single dot
  // from the ellipsis. A lone dot is ambiguous with a real current-directory
  // path, especially on a failed row with a long diagnostic suffix.
  if (ellipsisWidth >= width) return truncateToWidth(line, width, "");

  const contentWidth = width - ellipsisWidth;
  const leftWidth = Math.ceil(contentWidth / 2);
  const rightWidth = Math.floor(contentWidth / 2);
  const lineWidth = visibleWidth(line);
  const left = sliceByColumn(line, 0, leftWidth, true);
  const right = sliceByColumn(line, lineWidth - rightWidth, rightWidth, true);
  const result = `${left}${ellipsis}${right}`;
  // The right slice cannot include a reset that occurs after the source text.
  // Close ANSI styling explicitly so a truncated row cannot bleed into the
  // following transcript line.
  const safeResult = line.includes("\u001b") ? `${result}\u001b[0m` : result;

  // This second check is deliberately cheap insurance for unusual ANSI or
  // grapheme sequences supplied by a theme implementation.
  return visibleWidth(safeResult) <= width
    ? safeResult
    : truncateToWidth(line, width, "");
}

function styled(
  theme: ThemeLike,
  color: StoryboardColorName,
  text: string,
): string {
  return theme.fg(color, text);
}

function configuredMainMode(
  trimMode: "fileNames" | "commands" | "tools" | undefined,
  settings: PresentationSettings,
): TrimMode | undefined {
  if (trimMode === undefined) return undefined;
  if (trimMode === "fileNames") return settings.trimming.fileNames;
  if (trimMode === "commands") return settings.trimming.commands;
  return settings.trimming.tools;
}

function configuredMainFit(
  value: string,
  width: number,
  mode: TrimMode,
): string {
  switch (mode) {
    case "none":
      return value;
    case "end":
      return fit(value, width);
    case "middle":
      return fitMiddle(value, width);
  }
}

function continuationPrefix(prefix: string, width: number): string {
  const prefixWidth = visibleWidth(prefix);
  return width > prefixWidth ? " ".repeat(prefixWidth) : "";
}

function appendWrappedSegment(
  lines: string[],
  segment: string,
  width: number,
  continuation: string,
  fillCurrent = false,
): void {
  if (segment.length === 0) return;
  const last = lines.length - 1;
  const remaining = Math.max(0, width - visibleWidth(lines[last] ?? ""));
  if (visibleWidth(segment) <= remaining) {
    lines[last] = `${lines[last] ?? ""}${segment}`;
    return;
  }

  if (fillCurrent && remaining > 0) {
    const firstLines = wrapTextWithAnsi(segment, remaining);
    const first = firstLines.shift();
    if (first !== undefined) {
      lines[last] = `${lines[last] ?? ""}${first}`;
      for (const line of firstLines) {
        const next = `${continuation}${line}`;
        lines.push(visibleWidth(next) <= width ? next : fit(next, width));
      }
      return;
    }
  }

  const segmentWidth = Math.max(1, width - visibleWidth(continuation));
  for (const line of wrapTextWithAnsi(segment, segmentWidth)) {
    const next = `${continuation}${line}`;
    lines.push(visibleWidth(next) <= width ? next : fit(next, width));
  }
}

/** Append a trim-target value while leaving all other row text untrimmed. */
function appendTrimmedSegment(
  lines: string[],
  segment: string,
  width: number,
  continuation: string,
  mode: TrimMode,
): void {
  if (segment.length === 0) return;
  const last = lines.length - 1;
  const remaining = Math.max(0, width - visibleWidth(lines[last] ?? ""));
  if (remaining > 0) {
    const fitted = configuredMainFit(segment, remaining, mode);
    if (fitted.length > 0) {
      lines[last] = `${lines[last] ?? ""}${fitted}`;
      return;
    }
  }

  const lineWidth = Math.max(1, width - visibleWidth(continuation));
  const fitted = configuredMainFit(segment, lineWidth, mode);
  const next = `${continuation}${fitted}`;
  lines.push(visibleWidth(next) <= width ? next : fit(next, width));
}

/** Always start a new wrapped line, used for a failed-row diagnostic. */
function appendWrappedLine(
  lines: string[],
  segment: string,
  width: number,
  continuation: string,
): void {
  if (segment.length === 0) return;
  const segmentWidth = Math.max(1, width - visibleWidth(continuation));
  for (const line of wrapTextWithAnsi(segment, segmentWidth)) {
    const next = `${continuation}${line}`;
    lines.push(visibleWidth(next) <= width ? next : fit(next, width));
  }
}

/** Render one compact row, preserving complete non-target details by wrapping. */
function renderToolRow(
  row: ToolRowSnapshot,
  parts: ToolRowParts,
  normalDetailText: string,
  rowDetails: readonly string[],
  failure: string | undefined,
  prefix: string,
  width: number,
  theme: ThemeLike,
  settings: PresentationSettings,
): string[] {
  const prefixWidth = visibleWidth(prefix);
  const continuation = continuationPrefix(prefix, width);
  const lines: string[] = [width > prefixWidth ? prefix : ""];

  const appendText = (
    value: string,
    color: StoryboardColorName,
    trimTarget: "fileNames" | "commands" | "tools" | undefined,
  ): void => {
    if (value.length === 0) return;
    const segment = styled(theme, color, value);
    const mode = configuredMainMode(trimTarget, settings);
    if (mode === undefined || mode === "none") {
      appendWrappedSegment(lines, segment, width, continuation, true);
    } else {
      appendTrimmedSegment(lines, segment, width, continuation, mode);
    }
  };

  appendText(parts.mainPrefix ?? "", "text", undefined);
  appendText(mainValueForRow(row, parts), "text", parts.mainTrim);
  if (normalDetailText.length > 0) {
    appendWrappedSegment(
      lines,
      styled(theme, "muted", normalDetailText),
      width,
      continuation,
    );
  }
  for (const detail of rowDetails) {
    appendWrappedLine(lines, styled(theme, "muted", detail), width, continuation);
  }

  if (failure !== undefined) {
    appendWrappedLine(
      lines,
      styled(theme, settings.colors.status.failed, failure),
      width,
      continuation,
    );
  }
  return lines;
}

/** Render one compact group with only minimal failure text, never full result contents. */
export function renderToolGroup(
  group: GroupSnapshot,
  width: number,
  theme: ThemeLike,
  settings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): string[] {
  const safeWidth = normaliseWidth(width);
  const title = theme.bold ? theme.bold(heading(group.kind, group.rows.length)) : heading(group.kind, group.rows.length);
  // Native ToolExecutionComponent adds Spacer(1) before every tool row. Keep
  // that same one-line vertical rhythm when several rows become one group.
  // The leading space is Pi's normal one-cell horizontal output padding.
  const lines = new Spacer(1).render(safeWidth);
  lines.push(fit(` ${styled(theme, "toolTitle", title)}`, safeWidth));

  for (let rowIndex = 0; rowIndex < group.rows.length; rowIndex++) {
    const row = group.rows[rowIndex]!;
    const failed = row.result?.isError === true;
    const complete = !failed && row.result !== undefined && !row.isPartial;
    const color = failed
      ? settings.colors.status.failed
      : complete
        ? settings.colors.status.complete
        : settings.colors.status.running;
    const parts = formatRowParts(row);
    // One setting controls all optional compact detail suffixes: timing,
    // ranges, replacement counts, search metadata, cwd, and similar fields.
    // The primary path/command/tool-argument value and bounded failure diagnostic remain.
    const normalDetailText = settings.showToolMetadata
      ? `${parts.detail ?? ""}${elapsedDetail(row)}`
      : "";
    const failure = errorText(row);
    const marker = settings.symbols.toolDots[group.kind] ?? settings.symbols.toolDot;
    const prefix = styled(theme, color, `  ${marker} `);
    lines.push(...renderToolRow(
      row,
      parts,
      normalDetailText,
      group.rowDetails?.[rowIndex] ?? [],
      failure,
      prefix,
      safeWidth,
      theme,
      settings,
    ));
  }

  return lines;
}

// Exported for focused tests and for callers that want to inspect the pure
// argument presentation without constructing a group.
export const formatToolRow = formatRow;
