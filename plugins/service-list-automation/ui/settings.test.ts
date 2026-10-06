import { describe, expect, it } from 'vitest';
import { FIELD_PATHS } from './fields';
import {
  DEFAULT_SETTINGS,
  formatOverrides,
  getPath,
  isDefault,
  parseOverrides,
  setPath,
  sidecarSettings,
  withDefaults,
} from './settings';

/** Dotted paths of every leaf in `v` (free-form maps count as one leaf). */
function leaves(v: unknown, prefix = ''): string[] {
  if (prefix === 'form.verticalOverrides') return [prefix];
  if (typeof v === 'object' && v !== null) {
    return Object.entries(v).flatMap(([k, c]) => leaves(c, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

describe('defaults.json', () => {
  it('matches the current form and the 9-column CSV template', () => {
    expect(DEFAULT_SETTINGS.form.ids.create).toBe('B71233594014006408');
    expect(DEFAULT_SETTINGS.form.constants.l1).toBe('SME OFFLINE');
    // MID, code, description, merchant, CATEGORY, L2, L3, L4, L6 (0-based).
    expect(DEFAULT_SETTINGS.csv.columns).toMatchObject({ serviceCode: 1, l2: 5, l3: 6, l4: 7, l6: 8 });
    expect(DEFAULT_SETTINGS.csv.autoDetect).toBe(true);
    expect(DEFAULT_SETTINGS.behavior.inputMode).toBe('trusted');
    expect(DEFAULT_SETTINGS.behavior.dryRun).toBe(true);
  });

  it('every setting is editable somewhere on the settings screen', () => {
    // Edited on the Run screen instead: the URL, and the dry-run switch (never a saved preference).
    const edited = new Set([...FIELD_PATHS, 'connection.url', 'behavior.dryRun']);
    const missing = leaves(DEFAULT_SETTINGS).filter((p) => !edited.has(p));
    expect(missing).toEqual([]);
  });

  it('every field on the settings screen points at a real setting', () => {
    for (const p of FIELD_PATHS) expect(getPath(DEFAULT_SETTINGS, p), p).not.toBeUndefined();
  });
});

describe('withDefaults', () => {
  it('fills a partial or older saved state from the defaults', () => {
    const s = withDefaults({ behavior: { timeoutMs: 500 }, form: { ids: { submit: 'S' } } });
    expect(s.behavior.timeoutMs).toBe(500);
    expect(s.behavior.closeTimeoutMs).toBe(DEFAULT_SETTINGS.behavior.closeTimeoutMs);
    expect(s.form.ids.submit).toBe('S');
    expect(s.form.ids.create).toBe(DEFAULT_SETTINGS.form.ids.create);
  });

  it('turns nothing, garbage or wrong types into the defaults', () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(withDefaults('nope')).toEqual(DEFAULT_SETTINGS);
    expect(withDefaults({ behavior: { timeoutMs: 'soon', dryRun: 1 } }).behavior).toEqual(DEFAULT_SETTINGS.behavior);
  });

  it('drops keys the defaults no longer have', () => {
    const s = withDefaults({ behavior: { retiredOption: true } }) as unknown as { behavior: Record<string, unknown> };
    expect('retiredOption' in s.behavior).toBe(false);
  });

  it('keeps the user’s own vertical overrides instead of merging with the default ones', () => {
    const s = withDefaults({ form: { verticalOverrides: { KIDS: 'KIDS - OTHER' } } });
    expect(s.form.verticalOverrides).toEqual({ KIDS: 'KIDS - OTHER' });
    expect(withDefaults({ form: { verticalOverrides: {} } }).form.verticalOverrides).toEqual({});
  });

  it('does not share objects with the defaults, so editing cannot corrupt them', () => {
    const s = withDefaults(undefined);
    s.form.ids.create = 'changed';
    expect(DEFAULT_SETTINGS.form.ids.create).toBe('B71233594014006408');
  });
});

describe('paths', () => {
  it('setPath is immutable and getPath reads it back', () => {
    const next = setPath(DEFAULT_SETTINGS, 'behavior.timeoutMs', 1);
    expect(getPath(next, 'behavior.timeoutMs')).toBe(1);
    expect(DEFAULT_SETTINGS.behavior.timeoutMs).toBe(10000);
    expect(next.form).toBe(DEFAULT_SETTINGS.form);
  });

  it('isDefault tells changed from unchanged', () => {
    expect(isDefault(DEFAULT_SETTINGS, 'behavior.timeoutMs')).toBe(true);
    expect(isDefault(setPath(DEFAULT_SETTINGS, 'behavior.timeoutMs', 1), 'behavior.timeoutMs')).toBe(false);
  });
});

describe('vertical overrides text', () => {
  it('round-trips', () => {
    const map = { GROCERY: 'GROCERY - OTHER', KIDS: 'KIDS - OTHER' };
    expect(parseOverrides(formatOverrides(map))).toEqual(map);
  });

  it('ignores blank and malformed lines, keeps "=" inside the value', () => {
    expect(parseOverrides('A=B\n\nnonsense\n=x\nC=\n D = E=F ')).toEqual({ A: 'B', D: 'E=F' });
  });
});

describe('sidecarSettings', () => {
  it('sends only what the sidecar reads', () => {
    expect(Object.keys(sidecarSettings(DEFAULT_SETTINGS, true)).sort()).toEqual(['behavior', 'form']);
  });

  it('takes dryRun from the caller, never from saved settings', () => {
    // An old saved state that says dryRun:false must not turn into a real run.
    const saved = withDefaults({ behavior: { dryRun: false } });
    expect(saved.behavior.dryRun).toBe(false);
    expect(sidecarSettings(saved, true).behavior.dryRun).toBe(true);
    expect(sidecarSettings(saved, false).behavior.dryRun).toBe(false);
  });

  it('a fresh install defaults to a dry run', () => {
    expect(DEFAULT_SETTINGS.behavior.dryRun).toBe(true);
  });
});
