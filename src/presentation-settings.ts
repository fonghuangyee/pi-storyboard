import type { GroupKind } from "./grouping.ts";

export const PRESENTATION_SETTINGS_KEY = "pi-storyboard" as const;

export const STORYBOARD_COLOR_NAMES = [
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
] as const;

export type StoryboardColorName = (typeof STORYBOARD_COLOR_NAMES)[number];

const GROUP_KINDS: readonly GroupKind[] = [
  "read",
  "search",
  "list",
  "write",
  "edit",
  "command",
  "tool",
];

export type PresentationSettings = Readonly<{
  trimming: Readonly<{
    fileNames: boolean;
    commands: boolean;
  }>;
  symbols: Readonly<{
    toolDot: string;
    toolDots: Readonly<Record<GroupKind, string>>;
    thinkingRoot: string;
    thinkingStep: string;
    thinkingPlaceholder: string;
    hiddenThinking: string;
    rail: string;
    branch: string;
    lastBranch: string;
  }>;
  colors: Readonly<{
    status: Readonly<{
      running: StoryboardColorName;
      complete: StoryboardColorName;
      failed: StoryboardColorName;
      note: StoryboardColorName;
    }>;
    thinking: Readonly<{
      active: StoryboardColorName;
      settled: StoryboardColorName;
    }>;
    structure: StoryboardColorName;
  }>;
}>;

export type PresentationSettingsDraft = {
  trimming: {
    fileNames: boolean;
    commands: boolean;
  };
  symbols: {
    toolDot: string;
    toolDots: Record<GroupKind, string>;
    thinkingRoot: string;
    thinkingStep: string;
    thinkingPlaceholder: string;
    hiddenThinking: string;
    rail: string;
    branch: string;
    lastBranch: string;
  };
  colors: {
    status: {
      running: StoryboardColorName;
      complete: StoryboardColorName;
      failed: StoryboardColorName;
      note: StoryboardColorName;
    };
    thinking: {
      active: StoryboardColorName;
      settled: StoryboardColorName;
    };
    structure: StoryboardColorName;
  };
};

const DEFAULT_TOOL_DOTS: Record<GroupKind, string> = {
  read: "●",
  search: "●",
  list: "●",
  write: "●",
  edit: "●",
  command: "●",
  tool: "●",
};

const DEFAULT_MUTABLE_SETTINGS: PresentationSettingsDraft = {
  trimming: {
    fileNames: true,
    commands: true,
  },
  symbols: {
    toolDot: "●",
    toolDots: { ...DEFAULT_TOOL_DOTS },
    thinkingRoot: "◉",
    thinkingStep: "○",
    thinkingPlaceholder: "Thinking...",
    hiddenThinking: "↳",
    rail: "│",
    branch: "├─",
    lastBranch: "╰─",
  },
  colors: {
    status: {
      running: "syntaxKeyword",
      complete: "success",
      failed: "error",
      note: "muted",
    },
    thinking: {
      active: "syntaxKeyword",
      settled: "success",
    },
    structure: "muted",
  },
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export const DEFAULT_PRESENTATION_SETTINGS: PresentationSettings = deepFreeze(
  structuredClone(DEFAULT_MUTABLE_SETTINGS),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const candidate = value[key];
  return isRecord(candidate) ? candidate : {};
}

function namespaceFromSettings(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  if (hasOwn(value, PRESENTATION_SETTINGS_KEY)) {
    return isRecord(value[PRESENTATION_SETTINGS_KEY])
      ? value[PRESENTATION_SETTINGS_KEY] as Record<string, unknown>
      : {};
  }
  // Accept a bare namespace as well as the complete Pi settings object. The
  // store still reads the namespaced object explicitly, but this keeps the
  // pure normalizer useful for editor drafts and focused callers.
  return value;
}

function isAllowedColor(value: unknown): value is StoryboardColorName {
  return typeof value === "string" && (STORYBOARD_COLOR_NAMES as readonly string[]).includes(value);
}

function approximateVisibleWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    if (/^[\p{M}\u200b\u200c\u200d\ufe0e\ufe0f]$/u.test(character)) continue;
    const codePoint = character.codePointAt(0) ?? 0;
    const wide =
      (codePoint >= 0x1100 && codePoint <= 0x115f) ||
      (codePoint >= 0x2329 && codePoint <= 0x232a) ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff01 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

function validDisplayString(value: unknown, maxWidth: number): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) return false;
  if (/\u001b|\u009b|\u009d/u.test(value)) return false;
  return approximateVisibleWidth(value) <= maxWidth;
}

function validPlaceholder(value: unknown): value is string {
  return validDisplayString(value, 64);
}

function readBoolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof source[key] === "boolean" ? source[key] : fallback;
}

function readSymbol(
  source: Record<string, unknown>,
  key: string,
  fallback: string,
  maxWidth: number,
): string {
  return validDisplayString(source[key], maxWidth) ? source[key] : fallback;
}

function readPlaceholder(source: Record<string, unknown>, key: string, fallback: string): string {
  return validPlaceholder(source[key]) ? source[key] : fallback;
}

function readColor(
  source: Record<string, unknown>,
  key: string,
  fallback: StoryboardColorName,
): StoryboardColorName {
  return isAllowedColor(source[key]) ? source[key] : fallback;
}

/**
 * Validate arbitrary settings JSON into a complete immutable presentation
 * snapshot. Invalid fields fall back independently so one bad value cannot
 * disable the storyboard renderer.
 */
export function normalizePresentationSettings(
  value: unknown,
  fallback: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): PresentationSettings {
  const source = namespaceFromSettings(value);
  const trimming = nestedRecord(source, "trimming");
  const symbols = nestedRecord(source, "symbols");
  const toolDots = nestedRecord(symbols, "toolDots");
  const colors = nestedRecord(source, "colors");
  const status = nestedRecord(colors, "status");
  const thinking = nestedRecord(colors, "thinking");

  const toolDotIsValid = validDisplayString(symbols.toolDot, 4);
  const toolDot = readSymbol(symbols, "toolDot", fallback.symbols.toolDot, 4);
  const normalized: PresentationSettingsDraft = {
    trimming: {
      fileNames: readBoolean(trimming, "fileNames", fallback.trimming.fileNames),
      commands: readBoolean(trimming, "commands", fallback.trimming.commands),
    },
    symbols: {
      toolDot,
      toolDots: { ...fallback.symbols.toolDots },
      thinkingRoot: readSymbol(symbols, "thinkingRoot", fallback.symbols.thinkingRoot, 8),
      thinkingStep: readSymbol(symbols, "thinkingStep", fallback.symbols.thinkingStep, 8),
      thinkingPlaceholder: readPlaceholder(
        symbols,
        "thinkingPlaceholder",
        fallback.symbols.thinkingPlaceholder,
      ),
      hiddenThinking: readSymbol(symbols, "hiddenThinking", fallback.symbols.hiddenThinking, 8),
      rail: readSymbol(symbols, "rail", fallback.symbols.rail, 8),
      branch: readSymbol(symbols, "branch", fallback.symbols.branch, 12),
      lastBranch: readSymbol(symbols, "lastBranch", fallback.symbols.lastBranch, 12),
    },
    colors: {
      status: {
        running: readColor(status, "running", fallback.colors.status.running),
        complete: readColor(status, "complete", fallback.colors.status.complete),
        failed: readColor(status, "failed", fallback.colors.status.failed),
        note: readColor(status, "note", fallback.colors.status.note),
      },
      thinking: {
        active: readColor(thinking, "active", fallback.colors.thinking.active),
        settled: readColor(thinking, "settled", fallback.colors.thinking.settled),
      },
      structure: readColor(colors, "structure", fallback.colors.structure),
    },
  };

  for (const kind of GROUP_KINDS) {
    // An absent kind-specific dot inherits the effective default tool dot when
    // a valid default is supplied at this scope. An explicitly invalid project
    // dot instead inherits the lower-precedence kind-specific value, so a bad project
    // field cannot erase a distinct global override; at the built-in scope it
    // falls back to that scope's validated default dot.
    const kindFallback = hasOwn(toolDots, kind)
      ? fallback === DEFAULT_PRESENTATION_SETTINGS && toolDotIsValid
        ? toolDot
        : fallback.symbols.toolDots[kind] ?? fallback.symbols.toolDot
      : toolDotIsValid
        ? toolDot
        : fallback.symbols.toolDots[kind] ?? fallback.symbols.toolDot;
    normalized.symbols.toolDots[kind] = readSymbol(toolDots, kind, kindFallback, 4);
  }

  return deepFreeze(normalized);
}

/** Normalize a namespace object without applying a project override. */
export function normalizePresentationNamespace(
  value: unknown,
  fallback: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS,
): PresentationSettings {
  return normalizePresentationSettings({ [PRESENTATION_SETTINGS_KEY]: value }, fallback);
}

/**
 * Resolve global/project Pi settings. Project values are ignored when the
 * caller reports that the project is not trusted. Invalid project fields fall
 * back to their corresponding validated global values rather than resetting
 * unrelated global customization to the built-in defaults.
 */
export function resolvePresentationSettings(
  globalSettings: unknown,
  projectSettings: unknown = undefined,
  projectTrusted = true,
): PresentationSettings {
  const global = normalizePresentationSettings(globalSettings);
  const projectNamespace = projectTrusted ? namespaceFromSettings(projectSettings) : {};
  return normalizePresentationSettings(
    { [PRESENTATION_SETTINGS_KEY]: projectNamespace },
    global,
  );
}

/** Return a mutable clone suitable for an interactive settings editor. */
export function clonePresentationSettings(settings: PresentationSettings): PresentationSettingsDraft {
  return structuredClone(settings);
}

/** Return the complete namespace payload written to Pi settings JSON. */
export function serializePresentationSettings(settings: PresentationSettings): Record<string, unknown> {
  return structuredClone(settings) as unknown as Record<string, unknown>;
}

/** Small helper used by tests and the settings page. */
export function isValidPresentationSymbol(value: unknown): boolean {
  return validDisplayString(value, 12);
}

/** Group kinds exposed by the settings page, in stable display order. */
export const presentationGroupKinds: readonly GroupKind[] = GROUP_KINDS;

/** Color tokens exposed by the settings page, in stable display order. */
export const presentationColorNames: readonly StoryboardColorName[] = STORYBOARD_COLOR_NAMES;