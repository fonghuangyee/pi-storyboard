import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installToolGroupingPatch, type PatchHandle } from "./pi-adapter.ts";
import {
  DEFAULT_PRESENTATION_SETTINGS,
  type PresentationSettings,
} from "./presentation-settings.ts";
import {
  createPresentationSettingsManager,
  editablePresentationSettings,
  readPresentationSettings,
  writePresentationSettings,
  type PresentationSettingsScope,
} from "./presentation-settings-store.ts";
import { renderToolGroup } from "./renderer.ts";
import { TuiPreview } from "./tui-preview.ts";
import { buildSessionProjection, type SessionProjection } from "./session-projection.ts";

/**
 * Presentation-only extension entry point. The renderer is installed only in
 * the interactive TUI; session replacement/reload gets a fresh handle.
 */
export default function (pi: ExtensionAPI): void {
  pi.registerCommand("storyboard-settings", {
    description: "Configure Pi storyboard presentation settings",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/storyboard-settings is only available in interactive TUI mode", "warning");
        return;
      }

      const requestedScope = args.trim();
      let scope: PresentationSettingsScope | undefined =
        requestedScope === "global" || requestedScope === "project" ? requestedScope : undefined;
      if (requestedScope !== "" && scope === undefined) {
        ctx.ui.notify("Usage: /storyboard-settings [global|project]", "warning");
        return;
      }
      if (scope === "project" && !ctx.isProjectTrusted()) {
        ctx.ui.notify("Project settings are unavailable until this project is trusted", "warning");
        return;
      }

      if (scope === undefined) {
        const choices = ctx.isProjectTrusted() ? ["global", "project"] : ["global"];
        const selected = await ctx.ui.select(
          "Save storyboard settings to:",
          choices.map((choice) => choice === "global" ? "Global settings" : "Project settings"),
        );
        if (selected === undefined) return;
        scope = selected === "Project settings" ? "project" : "global";
      }

      try {
        const manager = createPresentationSettingsManager(ctx);
        const source = readPresentationSettings(ctx.cwd, manager);
        const initial = editablePresentationSettings(source, scope);
        // Load the optional settings UI only for the user-initiated command so
        // an older Pi without SettingsList cannot disable storyboard rendering.
        const { openPresentationSettings } = await import("./presentation-settings-ui.ts");
        const result = await openPresentationSettings(ctx, initial, scope);
        if (result === null) return;
        writePresentationSettings(ctx.cwd, scope, result);
        ctx.ui.notify("Storyboard settings saved; reloading Pi extensions...", "info");
        await ctx.reload();
      } catch (error) {
        ctx.ui.notify(`Could not save storyboard settings: ${String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("storyboard-preview", {
    description: "Preview Pi storyboards and available pi-tui components",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/storyboard-preview is only available in interactive TUI mode", "warning");
        return;
      }

      await ctx.ui.custom<void>((tui, theme, _keybindings, done) =>
        new TuiPreview(tui, theme, () => done(undefined), ctx.cwd),
      );
    },
  });

  let patch: PatchHandle | undefined;
  let presentationSettings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS;
  let invalidateProjection: () => void = () => undefined;

  const invalidate = (): void => invalidateProjection();
  pi.on("message_end", invalidate);
  pi.on("turn_end", invalidate);
  pi.on("agent_end", invalidate);
  pi.on("agent_settled", invalidate);
  pi.on("tool_execution_end", invalidate);
  pi.on("session_compact", invalidate);
  pi.on("session_compact_failed", invalidate);
  pi.on("session_tree", invalidate);
  pi.on("session_before_switch", invalidate);
  pi.on("session_before_fork", invalidate);
  pi.on("session_before_tree", invalidate);

  pi.on("session_start", (_event, ctx) => {
    patch?.uninstall();
    patch = undefined;
    invalidateProjection = () => undefined;
    presentationSettings = DEFAULT_PRESENTATION_SETTINGS;
    try {
      const manager = createPresentationSettingsManager(ctx);
      presentationSettings = readPresentationSettings(ctx.cwd, manager).effective;
    } catch {
      // Malformed or unavailable settings must never disable native/storyboard rendering.
    }
    if (ctx.mode !== "tui") return;

    const sessionManager = ctx.sessionManager;
    let dirty = true;
    let projection: SessionProjection | undefined;
    invalidateProjection = () => {
      dirty = true;
      projection = undefined;
    };
    const getSessionProjection = (): SessionProjection | undefined => {
      if (!dirty) return projection;
      dirty = false;
      try {
        // `buildContextEntries()` is the active-path snapshot. Do not read the
        // manager's leaf in a second call: a triggerTurn custom message (for
        // example pi-web-access's content-ready notification) can advance the
        // leaf between those reads and make an otherwise valid snapshot look
        // malformed. The final entry is the leaf for this exact snapshot.
        const entries = sessionManager.buildContextEntries();
        const snapshotLeafId = entries.at(-1)?.id ?? null;
        projection = buildSessionProjection({
          entries,
          leafId: snapshotLeafId,
        });
      } catch {
        projection = undefined;
      }
      return projection;
    };

    patch = installToolGroupingPatch({
      getTheme: () => ctx.ui.theme,
      getSettings: () => presentationSettings,
      renderGroup: (group, width, theme, settings) =>
        renderToolGroup(group, width, theme, settings ?? presentationSettings),
      getSessionProjection,
    });
  });

  pi.on("session_shutdown", () => {
    patch?.uninstall();
    patch = undefined;
    presentationSettings = DEFAULT_PRESENTATION_SETTINGS;
    invalidateProjection = () => undefined;
  });
}
