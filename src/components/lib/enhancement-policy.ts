export type EnhancementTier = "static" | "light" | "full";

type EnhancementSignals = {
  reducedMotion: boolean;
  saveData: boolean;
  coarsePointer: boolean;
  webglAvailable?: boolean | undefined;
  connectionType?: string | undefined;
  memory?: number | undefined;
  cores?: number | undefined;
};

type EnhancementConnection = EventTarget & { saveData?: boolean; effectiveType?: string };
type EnhancementNavigator = Navigator & {
  connection?: EnhancementConnection;
  deviceMemory?: number;
};

const POLICY_CHANGE_EVENT = "site:enhancement-change";
let webglFailed = false;

/** Optional capacity hints only lower quality; their absence keeps the full artwork. */
export function enhancementTier(signals: EnhancementSignals): EnhancementTier {
  if (signals.reducedMotion || signals.saveData || signals.webglAvailable === false)
    return "static";
  if (
    signals.coarsePointer ||
    ["slow-2g", "2g", "3g"].includes(signals.connectionType ?? "") ||
    (signals.memory !== undefined && signals.memory <= 4) ||
    (signals.cores !== undefined && signals.cores <= 4)
  ) {
    return "light";
  }
  return "full";
}

function connection() {
  // SAFETY: these optional browser hints are absent from lib.dom and remain optional here.
  return (navigator as EnhancementNavigator).connection;
}

export function readEnhancementTier(): EnhancementTier {
  // SAFETY: deviceMemory is an optional browser hint; unsupported engines use undefined.
  const memory = (navigator as EnhancementNavigator).deviceMemory;
  return enhancementTier({
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    saveData: connection()?.saveData === true,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    connectionType: connection()?.effectiveType,
    webglAvailable: webglFailed ? false : undefined,
    memory,
    cores: navigator.hardwareConcurrency,
  });
}

/** Share a failure discovered by an intended effect; never probe during first paint. */
export function reportWebGLFailure() {
  if (webglFailed) return;
  webglFailed = true;
  window.dispatchEvent(new Event(POLICY_CHANGE_EVENT));
}

export function watchEnhancementPolicy(changed: () => void, signal: AbortSignal) {
  for (const query of ["(prefers-reduced-motion: reduce)", "(pointer: coarse)"]) {
    window.matchMedia(query).addEventListener("change", changed, { signal });
  }
  connection()?.addEventListener("change", changed, { signal });
  window.addEventListener(POLICY_CHANGE_EVENT, changed, { signal });
}
