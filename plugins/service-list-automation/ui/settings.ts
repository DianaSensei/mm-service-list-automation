import defaultsJson from '../defaults.json';

// `defaults.json` is shared with the sidecar (it embeds the same file), so the
// values the UI resets to are the ones the sidecar falls back to.

export type InputMode = 'trusted' | 'script';
export type OptionMatch = 'exact' | 'ignoreCase' | 'contains';

export interface Settings {
  connection: { port: number; url: string; urlContains: string; chromePath: string };
  csv: {
    skipHeader: boolean;
    /** Match columns by header name when the file has a header. */
    autoDetect: boolean;
    /** 0-based column index of each field. */
    columns: Record<ColumnKey, number>;
  };
  form: {
    constants: { l1: string; l5: string; groupCodeL1: string; project: string };
    verticalOverrides: Record<string, string>;
    ids: Record<IdKey, string>;
  };
  behavior: {
    timeoutMs: number;
    closeTimeoutMs: number;
    readyTimeoutMs: number;
    inputMode: InputMode;
    optionMatch: OptionMatch;
    maxConsecutiveFailures: number;
    /** Not a saved preference: the Run screen starts every session as a dry run and
     *  passes the choice with each run (see `sidecarSettings`). */
    dryRun: boolean;
    dryRunHoldMs: number;
    afterSubmitSettleMs: number;
    dialogOpenWaitMs: number;
    createAttempts: number;
  };
}

export type ColumnKey = 'mid' | 'serviceCode' | 'serviceDescription' | 'merchantName' | 'l2' | 'l3' | 'l4' | 'l6';
export type IdKey =
  | 'create' | 'serviceCode' | 'serviceDescription' | 'merchant' | 'l1' | 'l2' | 'l3' | 'l4' | 'l5' | 'l6'
  | 'groupCodeL1' | 'vertical' | 'project' | 'check' | 'submit';

export const DEFAULT_SETTINGS = defaultsJson as unknown as Settings;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `over` laid on `base`, key by key. Only keys `base` knows survive, so a
 *  field removed from the defaults in a later release is dropped from saved
 *  state, and values of the wrong type fall back to the default. */
function mergeKnown(base: unknown, over: unknown): unknown {
  if (isObj(base)) {
    const out: Obj = {};
    for (const [k, b] of Object.entries(base)) {
      // A default that is not overridden is copied, never shared: callers edit what they get.
      out[k] = isObj(over) && k in over ? mergeKnown(b, over[k]) : structuredClone(b);
    }
    // Free-form maps (e.g. vertical overrides) keep the user's own keys.
    if (isObj(over) && Object.keys(base).length === 0) return { ...over };
    return out;
  }
  return typeof over === typeof base ? over : base;
}

/** Saved state (possibly from an older version, possibly partial) → full settings. */
export function withDefaults(saved: unknown): Settings {
  const merged = mergeKnown(DEFAULT_SETTINGS, saved) as Settings;
  // verticalOverrides is a free-form map: the user's keys replace the default's.
  const vo = isObj(saved) && isObj((saved as Obj).form) ? ((saved as Obj).form as Obj).verticalOverrides : undefined;
  if (isObj(vo)) {
    merged.form.verticalOverrides = Object.fromEntries(
      Object.entries(vo).filter(([, v]) => typeof v === 'string') as [string, string][],
    );
  }
  return merged;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (isObj(o) ? o[k] : undefined), obj);
}

/** Immutable set. */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const src = obj as unknown as Obj;
  return { ...src, [head]: rest.length ? setPath(src[head], rest.join('.'), value) : value } as T;
}

export const isDefault = (s: Settings, path: string) =>
  JSON.stringify(getPath(s, path)) === JSON.stringify(getPath(DEFAULT_SETTINGS, path));

// ── vertical overrides ⇄ "L3=Vertical" lines ─────────────────────────────────

export function formatOverrides(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

export function parseOverrides(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

// ── what the sidecar receives ─────────────────────────────────────────────────

/** `dryRun` is always passed in by the caller, never read from saved settings, so an
 *  old saved value can never turn into a real run. */
export function sidecarSettings(s: Settings, dryRun: boolean) {
  return { form: s.form, behavior: { ...s.behavior, dryRun } };
}
