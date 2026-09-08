/*
 * Shortcut labels are resolved here, at build time, rather than in the browser.
 *
 * `formatForDisplay` accepts an explicit platform, so every label a visitor
 * could see is baked into the HTML and CSS keeps the one that matches. Deciding
 * it in a client script instead would settle the key cap's width only after
 * hydration, and the search field it sits inside is laid out around that width.
 */
import { formatForDisplay, parseHotkey, type Hotkey } from "@tanstack/hotkeys";

type HotkeyPlatform = "mac" | "windows" | "linux";

const PLATFORMS = ["mac", "windows", "linux"] as const satisfies readonly HotkeyPlatform[];

/*
 * macOS draws a chord as unseparated glyphs (⌘⇧K); everywhere else spells the
 * modifiers out and joins them with a plus (Ctrl+Shift+K). The library's own
 * default spaces the mac symbols apart, which at the size these caps render
 * reads as three separate keys rather than one chord.
 */
const SEPARATOR_BY_PLATFORM = {
  mac: "",
  windows: "+",
  linux: "+",
} satisfies Record<HotkeyPlatform, string>;

interface ShortcutKeyVariant {
  display: string;
  /** Space-separated platform list, matched from CSS with `[data-platform~="mac"]`. */
  platforms: string;
}

interface ShortcutDisplay {
  /**
   * Every platform's spelling of the chord, for `aria-keyshortcuts`. The
   * attribute takes a space-separated list, so a `Mod` binding announces as
   * both `Meta+K` and `Control+K` without the markup having to guess.
   */
  ariaKeyShortcuts: string;
  variants: ShortcutKeyVariant[];
}

/**
 * Expands one canonical hotkey into the labels each platform should show.
 *
 * Identical labels are collapsed into a single variant, so a platform-agnostic
 * binding like `Escape` produces one element rather than three.
 */
export function resolveShortcutDisplay(
  hotkey: Hotkey | (string & {}),
  separator?: string | null,
): ShortcutDisplay {
  const variants: ShortcutKeyVariant[] = [];
  const spellings = new Set<string>();

  for (const platform of PLATFORMS) {
    const display = formatForDisplay(hotkey, {
      platform,
      separatorToken: separator === undefined ? SEPARATOR_BY_PLATFORM[platform] : separator,
    });
    const matching = variants.find((variant) => variant.display === display);

    if (matching) {
      matching.platforms += ` ${platform}`;
    } else {
      variants.push({ display, platforms: platform });
    }

    const { key, modifiers } = parseHotkey(hotkey, platform);

    spellings.add([...modifiers, key].join("+"));
  }

  return { ariaKeyShortcuts: [...spellings].join(" "), variants };
}
