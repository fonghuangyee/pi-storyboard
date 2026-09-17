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

  it("merges trusted project values and ignores untrusted project values", () => {
    const global = {
      "pi-storyboard": {
        trimming: { fileNames: false, commands: true },
        symbols: { toolDot: "G" },
      },
    };
    const project = {
      "pi-storyboard": {
        trimming: { commands: false },
        symbols: { thinkingRoot: "P" },
      },
    };

    const trusted = resolvePresentationSettings(global, project, true);
    expect(trusted.trimming).toEqual({ fileNames: false, commands: false });
    expect(trusted.symbols.toolDot).toBe("G");
    expect(trusted.symbols.thinkingRoot).toBe("P");

    const untrusted = resolvePresentationSettings(global, project, false);
    expect(untrusted.trimming).toEqual({ fileNames: false, commands: true });
    expect(untrusted.symbols.thinkingRoot).toBe("◉");
  });

  it("falls back invalid fields independently and sanitizes unknown tool dots", () => {
    const settings = normalizePresentationNamespace({
      trimming: { fileNames: "yes", commands: false },
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

    expect(settings.trimming).toEqual({ fileNames: true, commands: false });
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
          trimming: { fileNames: false, commands: true },
          symbols: { toolDot: "G", toolDots: { read: "R", search: "S" } },
          colors: { structure: "accent" },
        },
      },
      {
        "pi-storyboard": {
          trimming: { fileNames: "yes" },
          symbols: { toolDot: "\n", toolDots: { read: "\u001b[31m" } },
          colors: { structure: "not-a-theme" },
        },
      },
      true,
    );

    expect(settings.trimming).toEqual({ fileNames: false, commands: true });
    expect(settings.symbols.toolDot).toBe("G");
    expect(settings.symbols.toolDots.read).toBe("R");
    expect(settings.symbols.toolDots.search).toBe("S");
    expect(settings.colors.structure).toBe("accent");
  });

  it("preserves unrelated global/project JSON while writing the namespace", () => {
    const { cwd, agentDir } = tempPaths();
    const globalPath = join(agentDir, "settings.json");
    const projectDir = join(cwd, ".pi");
    const projectPath = join(projectDir, "settings.json");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(globalPath, JSON.stringify({ theme: "dark", keep: { value: 1 } }));
    writeFileSync(projectPath, JSON.stringify({ compaction: { enabled: false } }));

    const manager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    const source = readPresentationSettings(manager);
    writePresentationSettings(cwd, "project", source.effective, agentDir);

    const saved = JSON.parse(readFileSync(projectPath, "utf8")) as Record<string, unknown>;
    expect(saved.compaction).toEqual({ enabled: false });
    expect(saved["pi-storyboard"]).toEqual(source.effective);
    expect(JSON.parse(readFileSync(globalPath, "utf8"))).toEqual({
      theme: "dark",
      keep: { value: 1 },
    });
  });
});
