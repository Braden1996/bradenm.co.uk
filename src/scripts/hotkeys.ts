/*
 * Lifecycle wrapper over the TanStack hotkey manager.
 *
 * The manager is a singleton holding one listener per target, so registrations
 * have to be torn down when the client router swaps a page out or they pile up
 * across navigations and fire against detached elements. Components here already
 * scope their listeners with an `AbortController`, so this takes the same signal
 * and unregisters alongside them.
 */
import {
  getHotkeyManager,
  type HotkeyCallback,
  type HotkeyOptions,
  type HotkeyRegistrationHandle,
  type RegisterableHotkey,
} from "@tanstack/hotkeys";

interface RegisterShortcutOptions extends HotkeyOptions {
  signal?: AbortSignal;
}

export function registerShortcut(
  hotkey: RegisterableHotkey,
  callback: HotkeyCallback,
  { signal, ...options }: RegisterShortcutOptions = {},
): HotkeyRegistrationHandle {
  const handle = getHotkeyManager().register(hotkey, callback, options);

  signal?.addEventListener("abort", () => handle.unregister(), { once: true });

  return handle;
}
