import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installToolGroupingPatch, type PatchHandle } from "./pi-adapter.ts";
import {
  DEFAULT_PRESENTATION_SETTINGS,
  type PresentationSettings,
} from "./presentation-settings.ts";
import {
  createPresentationSettingsManager,
  readGlobalPresentationSettings,
  readPresentationSettings,
  writePresentationSettings,
} from "./presentation-settings-store.ts";
import { renderToolGroup } from "./renderer.ts";
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
      if (requestedScope !== "" && requestedScope !== "global") {
        ctx.ui.notify("Usage: /storyboard-settings [global] (project settings are not supported)", "warning");
        return;
      }
      const scope = "global";

      try {
        const initial = readGlobalPresentationSettings(ctx.cwd);
        // Load the optional settings UI only for the user-initiated command so
        // an older Pi without SettingsList cannot disable storyboard rendering.
        const { openPresentationSettings } = await import("./presentation-settings-ui.ts");
        const result = await openPresentationSettings(ctx, initial);
        if (result === null) return;
        writePresentationSettings(ctx.cwd, scope, result);
        ctx.ui.notify("Storyboard settings saved; reloading Pi extensions...", "info");
        await ctx.reload();
      } catch (error) {
        ctx.ui.notify(`Could not save storyboard settings: ${String(error)}`, "error");
      }
    },
  });

  let patch: PatchHandle | undefined;
  let storyboardEnabled = true;
  const statusKey = "pi-storyboard";
  pi.registerShortcut("alt+o", {
    description: "Toggle Storyboard view",
    handler: async (ctx) => {
      if (ctx.mode !== "tui" || patch === undefined) return;
      storyboardEnabled = !storyboardEnabled;
      ctx.ui.setStatus(statusKey, storyboardEnabled ? undefined : "Storyboard: off");
    },
  });
  let presentationSettings: PresentationSettings = DEFAULT_PRESENTATION_SETTINGS;
  let invalidateProjection: () => void = () => undefined;

  let activeThinking = new WeakMap<object, number>();
  pi.on("message_update", ({ message, assistantMessageEvent }, ctx) => {
    if (ctx.mode !== "tui" || message.role !== "assistant") return;
    const event = assistantMessageEvent;
    if (event.type === "thinking_start" || event.type === "thinking_delta") {
      activeThinking.set(message, event.contentIndex);
    } else {
      activeThinking.delete(message);
    }
  });

  const invalidate = (): void => invalidateProjection();
  pi.on("message_end", ({ message }) => {
    activeThinking.delete(message);
    invalidate();
  });
  pi.on("turn_end", invalidate);
  pi.on("agent_end", () => {
    activeThinking = new WeakMap();
    invalidate();
  });
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
    activeThinking = new WeakMap();
    invalidateProjection = () => undefined;
    presentationSettings = DEFAULT_PRESENTATION_SETTINGS;
    try {
      const manager = createPresentationSettingsManager(ctx);
      presentationSettings = readPresentationSettings(ctx.cwd, manager).effective;
    } catch {
      // Malformed or unavailable settings must never disable native/storyboard rendering.
    }
    if (ctx.mode !== "tui") return;
    if (!storyboardEnabled) ctx.ui.setStatus(statusKey, undefined);
    storyboardEnabled = true;

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
      isEnabled: () => storyboardEnabled,
      getTheme: () => ctx.ui.theme,
      getSettings: () => presentationSettings,
      getActiveThinkingIndex: (message) => activeThinking.get(message),
      renderGroup: renderToolGroup,
      getSessionProjection,
    });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    patch?.uninstall();
    patch = undefined;
    if (!storyboardEnabled && ctx.mode === "tui") ctx.ui.setStatus(statusKey, undefined);
    storyboardEnabled = true;
    presentationSettings = DEFAULT_PRESENTATION_SETTINGS;
    activeThinking = new WeakMap();
    invalidateProjection = () => undefined;
  });
}
