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
  });

  it("migrates the previous boolean trimming schema", () => {
    const settings = normalizePresentationSettings({
      "pi-storyboard": { trimming: { fileNames: true, commands: false } },
    });
    expect(settings.trimming).toEqual({ fileNames: "middle", commands: "none" });
  });

  it("merges trusted project values and ignores untrusted project values", () => {
    const global = {
      "pi-storyboard": {
        trimming: { fileNames: "none", commands: "middle" },
        symbols: { toolDot: "G" },
      },
    };
    const project = {
      "pi-storyboard": {
        trimming: { commands: "none" },
        symbols: { thinkingRoot: "P" },
      },
    };

    const trusted = resolvePresentationSettings(global, project, true);
    expect(trusted.trimming).toEqual({ fileNames: "none", commands: "none" });
    expect(trusted.symbols.toolDot).toBe("G");
    expect(trusted.symbols.thinkingRoot).toBe("P");

    const untrusted = resolvePresentationSettings(global, project, false);
    expect(untrusted.trimming).toEqual({ fileNames: "none", commands: "middle" });
    expect(untrusted.symbols.thinkingRoot).toBe("◉");
  });

  it("falls back invalid fields independently and sanitizes unknown tool dots", () => {
    const settings = normalizePresentationNamespace({
      trimming: { fileNames: "invalid", commands: "none" },
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

    expect(settings.trimming).toEqual({ fileNames: "middle", commands: "none" });
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

    expect(settings.trimming).toEqual({ fileNames: "none", commands: "middle" });
    expect(settings.symbols.toolDot).toBe("G");
    expect(settings.symbols.toolDots.read).toBe("R");
    expect(settings.symbols.toolDots.search).toBe("S");
    expect(settings.colors.structure).toBe("accent");
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
    }));
    writeFileSync(projectPath, JSON.stringify({
      trimming: { commands: "none" },
      symbols: { thinkingRoot: "P" },
    }));
    writeFileSync(piGlobalPath, JSON.stringify({ theme: "dark" }));
    writeFileSync(piProjectPath, JSON.stringify({ compaction: { enabled: false } }));

    const manager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    const source = readPresentationSettings(cwd, manager, agentDir);
    expect(source.global.trimming.fileNames).toBe("none");
    expect(source.effective.trimming).toEqual({ fileNames: "none", commands: "none" });
    expect(source.effective.symbols).toMatchObject({ toolDot: "G", thinkingRoot: "P" });

    writePresentationSettings(cwd, "project", source.effective, agentDir);

    expect(JSON.parse(readFileSync(projectPath, "utf8"))).toEqual(source.effective);
    expect(JSON.parse(readFileSync(piGlobalPath, "utf8"))).toEqual({ theme: "dark" });
    expect(JSON.parse(readFileSync(piProjectPath, "utf8"))).toEqual({ compaction: { enabled: false } });
  });
});
