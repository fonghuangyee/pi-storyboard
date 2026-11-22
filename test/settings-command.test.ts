import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_PRESENTATION_SETTINGS } from "../src/presentation-settings.ts";
import type { PresentationSettings } from "../src/presentation-settings.ts";

const settingsMocks = vi.hoisted(() => ({
  readGlobal: vi.fn(),
  write: vi.fn(),
  open: vi.fn(),
}));

vi.mock("../src/pi-adapter.ts", () => ({ installToolGroupingPatch: vi.fn() }));
vi.mock("../src/presentation-settings-store.ts", () => ({
  readGlobalPresentationSettings: settingsMocks.readGlobal,
  writePresentationSettings: settingsMocks.write,
}));
vi.mock("../src/presentation-settings-ui.ts", () => ({
  openPresentationSettings: settingsMocks.open,
}));

import extension from "../src/index.ts";
import { installToolGroupingPatch } from "../src/pi-adapter.ts";

type SettingsCommand = {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
};

describe("storyboard-settings command", () => {
  let command: SettingsCommand;
  let context: ExtensionCommandContext;
  let select: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn>;
  let reload: ReturnType<typeof vi.fn>;
  const setStatus = vi.fn();
  const registerShortcut = vi.fn<ExtensionAPI["registerShortcut"]>();
  const on = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    settingsMocks.readGlobal.mockReturnValue(DEFAULT_PRESENTATION_SETTINGS);
    settingsMocks.open.mockResolvedValue(DEFAULT_PRESENTATION_SETTINGS satisfies PresentationSettings);

    select = vi.fn();
    notify = vi.fn();
    reload = vi.fn().mockResolvedValue(undefined);
    context = {
      mode: "tui",
      cwd: "/project",
      isProjectTrusted: vi.fn(() => true),
      ui: { select, notify, setStatus },
      reload,
    } as unknown as ExtensionCommandContext;

    const pi = {
      registerCommand: (_name: string, registered: SettingsCommand) => { command = registered; },
      registerShortcut,
      on,
    };
    extension(pi as unknown as ExtensionAPI);
  });

  it("opens and saves global settings directly without asking for a scope", async () => {
    await command.handler("", context);

    expect(select).not.toHaveBeenCalled();
    expect(settingsMocks.readGlobal).toHaveBeenCalledWith("/project");
    expect(settingsMocks.open).toHaveBeenCalledWith(context, DEFAULT_PRESENTATION_SETTINGS);
    expect(settingsMocks.write).toHaveBeenCalledWith(
      "/project",
      "global",
      DEFAULT_PRESENTATION_SETTINGS,
    );
    expect(reload).toHaveBeenCalledOnce();
  });

  it("toggles only the active TUI patch with Option+O and resets for a new session", async () => {
    const uninstall = vi.fn();
    vi.mocked(installToolGroupingPatch).mockReturnValue({ uninstall });
    const [[key, shortcut]] = registerShortcut.mock.calls;
    expect(key).toBe("alt+o");
    await shortcut.handler(context);
    expect(setStatus).not.toHaveBeenCalled();

    const start = on.mock.calls.find(([event]) => event === "session_start")![1];
    const shutdown = on.mock.calls.find(([event]) => event === "session_shutdown")![1];
    start({}, context);
    const [[options]] = vi.mocked(installToolGroupingPatch).mock.calls;
    expect(options.isEnabled?.()).toBe(true);
    await shortcut.handler(context);
    expect(options.isEnabled?.()).toBe(false);
    expect(setStatus).toHaveBeenLastCalledWith("pi-storyboard", "Storyboard: off");
    await shortcut.handler(context);
    expect(options.isEnabled?.()).toBe(true);
    expect(setStatus).toHaveBeenLastCalledWith("pi-storyboard", undefined);

    await shortcut.handler(context);
    shutdown({}, context);
    expect(uninstall).toHaveBeenCalledOnce();
    expect(setStatus).toHaveBeenLastCalledWith("pi-storyboard", undefined);
    start({}, context);
    expect(vi.mocked(installToolGroupingPatch).mock.lastCall?.[0].isEnabled?.()).toBe(true);
  });

  it("rejects the unsupported project argument", async () => {
    await command.handler("project", context);

    expect(notify).toHaveBeenCalledWith(
      "Usage: /storyboard-settings [global] (project settings are not supported)",
      "warning",
    );
    expect(settingsMocks.open).not.toHaveBeenCalled();
    expect(settingsMocks.write).not.toHaveBeenCalled();
  });
});
