import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_SETTINGS,
  normalizePresentationNamespace,
  normalizePresentationSettings,
  resolvePresentationSettings,
} from "../src/presentation-settings.ts";
import {
  readGlobalPresentationSettings,
  readPresentationSettings,
  writePresentationSettings,
} from "../src/presentation-settings-store.ts";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

function tempPaths(): { cwd: string; agentDir: string } {
  return {
    cwd: mkdtempSync(join(tmpdir(), "pi-storyboard-cwd-")),
    agentDir: mkdtempSync(join(tmpdir(), "pi-storyboard-agent-")),
  };
}

describe("presentation settings", () => {
  it("returns immutable current defaults for absent settings", () => {
    const settings = normalizePresentationSettings(undefined);
    expect(settings).toEqual(DEFAULT_PRESENTATION_SETTINGS);
    expect(Object.isFrozen(settings)).toBe(true);
    expect(Object.isFrozen(settings.symbols)).toBe(true);
    expect(Object.isFrozen(settings.colors.status)).toBe(true);
    expect(settings.showToolMetadata).toBe(true);
    expect(settings.showToolResultSummary).toBe(true);
  });

  it("defaults to unlimited roots and validates layered limits independently", () => {
    expect(normalizePresentationSettings(undefined).maxThinkingRoots).toBeNull();
    const global = { maxThinkingRoots: 4 };
    for (const invalid of [0, -1, 1.5, "3", Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(resolvePresentationSettings(global, { maxThinkingRoots: invalid }, true).maxThinkingRoots).toBe(4);
    }
    expect(resolvePresentationSettings(global, { maxThinkingRoots: 2 }, true).maxThinkingRoots).toBe(2);
    expect(resolvePresentationSettings(global, { maxThinkingRoots: null }, true).maxThinkingRoots).toBeNull();
    expect(resolvePresentationSettings(global, { maxThinkingRoots: 2 }, false).maxThinkingRoots).toBe(4);
  });

  it("validates skill colors with trusted precedence and independent fallbacks", () => {
    const global = { colors: { skillInvocation: "mdHeading" } };
    expect(normalizePresentationSettings(undefined).colors.skillInvocation).toBe("warning");
    expect(normalizePresentationSettings({ colors: { skillInvocation: "#ffaa00" } }).colors.skillInvocation).toBe("warning");
    expect(resolvePresentationSettings(global, { colors: { skillInvocation: "accent" } }, true).colors.skillInvocation).toBe("accent");
    expect(resolvePresentationSettings(global, { colors: { skillInvocation: "invalid" } }, true).colors.skillInvocation).toBe("mdHeading");
    expect(resolvePresentationSettings(global, { colors: { skillInvocation: "accent" } }, false).colors.skillInvocation).toBe("mdHeading");
  });

  it("ignores the retired skill symbol setting without affecting standard markers", () => {
    const global = { symbols: { skillInvocation: "◆", toolDot: "T", thinkingRoot: "M" } };
    const settings = resolvePresentationSettings(global, { symbols: { skillInvocation: "S" } }, true);
    expect(settings.symbols).not.toHaveProperty("skillInvocation");
    expect(settings.symbols).toMatchObject({ toolDot: "T", thinkingRoot: "M" });
    expect(normalizePresentationSettings(undefined).symbols).not.toHaveProperty("skillInvocation");
  });

  it("migrates the previous boolean trimming schema", () => {
    const settings = normalizePresentationSettings({
      "pi-storyboard": { trimming: { fileNames: true, commands: false } },
    });
    expect(settings.trimming).toEqual({ fileNames: "middle", commands: "none", tools: "middle" });
  });

  it("merges trusted project values and ignores untrusted project values", () => {
    const global = {
      "pi-storyboard": {
        trimming: { fileNames: "none", commands: "middle", tools: "middle" },
        showToolMetadata: false,
        showToolResultSummary: false,
        symbols: { toolDot: "G" },
      },
    };
    const project = {
      "pi-storyboard": {
        trimming: { commands: "none" },
        showToolMetadata: true,
        showToolResultSummary: true,
        symbols: { thinkingRoot: "P" },
      },
    };

    const trusted = resolvePresentationSettings(global, project, true);
    expect(trusted.trimming).toEqual({ fileNames: "none", commands: "none", tools: "middle" });
    expect(trusted.symbols.toolDot).toBe("G");
    expect(trusted.symbols.thinkingRoot).toBe("P");
    expect(trusted.showToolMetadata).toBe(true);
    expect(trusted.showToolResultSummary).toBe(true);

    const untrusted = resolvePresentationSettings(global, project, false);
    expect(untrusted.trimming).toEqual({ fileNames: "none", commands: "middle", tools: "middle" });
    expect(untrusted.symbols.thinkingRoot).toBe("◉");
    expect(untrusted.showToolMetadata).toBe(false);
    expect(untrusted.showToolResultSummary).toBe(false);
  });

  it("falls back invalid fields independently and sanitizes unknown tool dots", () => {
    const settings = normalizePresentationNamespace({
      trimming: { fileNames: "invalid", commands: "none" },
      showToolMetadata: "yes",
      showToolResultSummary: "yes",
      symbols: {
        toolDot: "T",
        toolDots: { read: "R", command: "\u001b[31m" },
        thinkingRoot: "\n",
        thinkingPlaceholder: "Waiting",
      },
      colors: {
        status: { running: "warning", complete: "not-a-theme" },
        structure: "accent",
      },
    });

    expect(settings.trimming).toEqual({ fileNames: "middle", commands: "none", tools: "middle" });
    expect(settings.showToolMetadata).toBe(true);
    expect(settings.showToolResultSummary).toBe(true);
    expect(settings.symbols.toolDot).toBe("T");
    expect(settings.symbols.toolDots.read).toBe("R");
    expect(settings.symbols.toolDots.command).toBe("T");
    expect(settings.symbols.thinkingRoot).toBe("◉");
    expect(settings.symbols.thinkingPlaceholder).toBe("Waiting");
    expect(settings.colors.status.running).toBe("warning");
    expect(settings.colors.status.complete).toBe("success");
    expect(settings.colors.structure).toBe("accent");
  });

  it("keeps valid global values when project overrides are malformed", () => {
    const settings = resolvePresentationSettings(
      {
        "pi-storyboard": {
          trimming: { fileNames: "none", commands: "middle" },
          symbols: { toolDot: "G", toolDots: { read: "R", search: "S" } },
          colors: { structure: "accent" },
        },
      },
      {
        "pi-storyboard": {
          trimming: { fileNames: "invalid" },
          symbols: { toolDot: "\n", toolDots: { read: "\u001b[31m" } },
          colors: { structure: "not-a-theme" },
        },
      },
      true,
    );

    expect(settings.trimming).toEqual({ fileNames: "none", commands: "middle", tools: "middle" });
    expect(settings.symbols.toolDot).toBe("G");
    expect(settings.symbols.toolDots.read).toBe("R");
    expect(settings.symbols.toolDots.search).toBe("S");
    expect(settings.colors.structure).toBe("accent");
  });

  it("reads global settings without depending on project settings", () => {
    const { cwd, agentDir } = tempPaths();
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(agentDir, "pi-storyboard.json"), JSON.stringify({
      trimming: { fileNames: "none" },
    }));
    writeFileSync(join(cwd, ".pi", "pi-storyboard.json"), "not valid JSON");

    expect(readGlobalPresentationSettings(cwd, agentDir).trimming.fileNames).toBe("none");
  });

  it("reads and writes dedicated files without changing Pi settings", () => {
    const { cwd, agentDir } = tempPaths();
    const globalPath = join(agentDir, "pi-storyboard.json");
    const projectDir = join(cwd, ".pi");
    const projectPath = join(projectDir, "pi-storyboard.json");
    const piGlobalPath = join(agentDir, "settings.json");
    const piProjectPath = join(projectDir, "settings.json");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(globalPath, JSON.stringify({
      trimming: { fileNames: "none" },
      symbols: { toolDot: "G" },
      colors: { skillInvocation: "mdHeading" },
    }));
    writeFileSync(projectPath, JSON.stringify({
      trimming: { commands: "none" },
      showToolResultSummary: false,
      symbols: { thinkingRoot: "P" },
    }));
    writeFileSync(piGlobalPath, JSON.stringify({ theme: "dark" }));
    writeFileSync(piProjectPath, JSON.stringify({ compaction: { enabled: false } }));

    const manager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    const source = readPresentationSettings(cwd, manager, agentDir);
    expect(source.global.trimming.fileNames).toBe("none");
    expect(source.effective.trimming).toEqual({ fileNames: "none", commands: "none", tools: "middle" });
    expect(source.effective.symbols).toMatchObject({ toolDot: "G", thinkingRoot: "P" });
    expect(source.effective.showToolResultSummary).toBe(false);
    expect(source.effective.colors.skillInvocation).toBe("mdHeading");

    writePresentationSettings(cwd, "project", source.effective, agentDir);
    writePresentationSettings(cwd, "global", { ...source.global, maxThinkingRoots: 3 }, agentDir);

    expect(readGlobalPresentationSettings(cwd, agentDir).maxThinkingRoots).toBe(3);
    expect(JSON.parse(readFileSync(projectPath, "utf8"))).toEqual(source.effective);
    expect(JSON.parse(readFileSync(piGlobalPath, "utf8"))).toEqual({ theme: "dark" });
    expect(JSON.parse(readFileSync(piProjectPath, "utf8"))).toEqual({ compaction: { enabled: false } });
  });
});
