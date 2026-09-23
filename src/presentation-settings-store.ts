import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
  ExtensionContext,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import {
  clonePresentationSettings,
  normalizePresentationNamespace,
  PRESENTATION_SETTINGS_KEY,
  normalizePresentationSettings,
  resolvePresentationSettings,
  serializePresentationSettings,
  type PresentationSettings,
  type PresentationSettingsDraft,
} from "./presentation-settings.ts";

export type PresentationSettingsScope = "global" | "project";

export type PresentationSettingsSource = {
  readonly global: PresentationSettings;
  readonly project: PresentationSettings;
  readonly effective: PresentationSettings;
};

type PublicSettingsApi = {
  readonly SettingsManager?: {
    create(
      cwd: string,
      agentDir?: string,
      options?: { projectTrusted?: boolean },
    ): SettingsManager;
  };
  readonly getAgentDir?: () => string;
  readonly CONFIG_DIR_NAME?: string;
};

// Keep the settings feature optional for Pi versions that do not expose the
// public SettingsManager factory yet. A namespace import lets the renderer
// continue loading instead of failing module evaluation on a missing named
// runtime export.
const publicSettingsApi = PiCodingAgent as unknown as PublicSettingsApi;

function defaultAgentDir(): string {
  if (typeof publicSettingsApi.getAgentDir !== "function") {
    throw new Error("Pi does not expose a public settings directory API");
  }
  return publicSettingsApi.getAgentDir();
}

function configDirName(): string {
  return typeof publicSettingsApi.CONFIG_DIR_NAME === "string"
    ? publicSettingsApi.CONFIG_DIR_NAME
    : ".pi";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PRESENTATION_SETTINGS_FILE = "pi-storyboard.json";

function settingsRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Create the public Pi settings reader for the current cwd/trust state. */
export function createPresentationSettingsManager(ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">): SettingsManager {
  const settingsManager = publicSettingsApi.SettingsManager;
  if (settingsManager === undefined || typeof settingsManager.create !== "function") {
    throw new Error("Pi does not expose a public SettingsManager factory");
  }
  return settingsManager.create(ctx.cwd, defaultAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  });
}

/** Read and validate the dedicated global/project storyboard settings files. */
export function readPresentationSettings(
  cwd: string,
  manager: Pick<SettingsManager, "isProjectTrusted">,
  agentDir?: string,
): PresentationSettingsSource {
  const globalRaw = settingsRecord(readSettingsFile(settingsFilePath(cwd, "global", agentDir)));
  const trusted = manager.isProjectTrusted();
  const projectRaw = trusted
    ? settingsRecord(readSettingsFile(settingsFilePath(cwd, "project", agentDir)))
    : {};
  const global = normalizePresentationNamespace(globalRaw);
  const project = normalizePresentationNamespace(projectRaw);
  const effective = resolvePresentationSettings(
    { [PRESENTATION_SETTINGS_KEY]: globalRaw },
    { [PRESENTATION_SETTINGS_KEY]: projectRaw },
    trusted,
  );
  return Object.freeze({ global, project, effective });
}

export function settingsFilePath(
  cwd: string,
  scope: PresentationSettingsScope,
  agentDir?: string,
): string {
  return scope === "global"
    ? join(agentDir ?? defaultAgentDir(), PRESENTATION_SETTINGS_FILE)
    : join(cwd, configDirName(), PRESENTATION_SETTINGS_FILE);
}

function readSettingsFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    const content = readFileSync(path, "utf8").replace(/^\uFEFF/u, "");
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Cannot save storyboard settings: ${path} is not valid JSON (${String(error)})`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Cannot save storyboard settings: ${path} must contain a JSON object`);
  }
  return parsed;
}

function writeSettingsFileAtomically(path: string, settings: Record<string, unknown>): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const content = `${JSON.stringify(settings, null, 2)}\n`;
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    if (existsSync(path)) chmodSync(temporaryPath, statSync(path).mode & 0o777);
    renameSync(temporaryPath, path);
  } finally {
    try {
      // The temporary file is absent after a successful rename.
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch {
      // The original write error is more useful than best-effort cleanup errors.
    }
  }
}

/** Persist the complete dedicated storyboard settings file after an explicit user save. */
export function writePresentationSettings(
  cwd: string,
  scope: PresentationSettingsScope,
  settings: PresentationSettings,
  agentDir?: string,
): void {
  const path = settingsFilePath(cwd, scope, agentDir);
  readSettingsFile(path);
  const validated = normalizePresentationSettings(settings);
  writeSettingsFileAtomically(path, serializePresentationSettings(validated));
}

/** Build a target-specific editable snapshot with global fallback for projects. */
export function editablePresentationSettings(
  source: PresentationSettingsSource,
  scope: PresentationSettingsScope,
): PresentationSettingsDraft {
  return clonePresentationSettings(scope === "project" ? source.effective : source.global);
}