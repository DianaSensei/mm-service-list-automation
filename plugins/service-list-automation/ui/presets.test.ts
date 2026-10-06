import { describe, expect, it } from 'vitest';
import { cleanPresets, deletePreset, matchingPreset, savePreset, type Constants } from './presets';

const C = (o: Partial<Constants> = {}): Constants => ({ l1: 'SME OFFLINE', l5: 'OTHER', groupCodeL1: 'PAYMENT', project: 'SME OFFLINE', ...o });

describe('savePreset', () => {
  it('adds a preset, trimmed, and keeps the list sorted by name', () => {
    let p = savePreset([], '  Zeta  ', C());
    p = savePreset(p, 'alpha', C({ l1: 'X' }));
    expect(p.map((x) => x.name)).toEqual(['alpha', 'Zeta']);
  });

  it('replaces a preset of the same name, ignoring case, instead of duplicating it', () => {
    const p = savePreset(savePreset([], 'Offline', C()), 'OFFLINE', C({ project: 'NEW' }));
    expect(p).toHaveLength(1);
    expect(p[0].name).toBe('OFFLINE');
    expect(p[0].constants.project).toBe('NEW');
  });

  it('ignores an empty name', () => {
    expect(savePreset([], '   ', C())).toEqual([]);
  });

  it('stores a copy, so editing the live values later cannot change the preset', () => {
    const live = C();
    const p = savePreset([], 'a', live);
    live.l1 = 'CHANGED';
    expect(p[0].constants.l1).toBe('SME OFFLINE');
  });
});

describe('deletePreset / matchingPreset', () => {
  const p = savePreset(savePreset([], 'a', C()), 'b', C({ l5: 'Z' }));
  it('deletes by name, ignoring case', () => {
    expect(deletePreset(p, 'A').map((x) => x.name)).toEqual(['b']);
  });
  it('finds the preset equal to the current values', () => {
    expect(matchingPreset(p, C({ l5: 'Z' }))?.name).toBe('b');
    expect(matchingPreset(p, C({ l5: 'nope' }))).toBeUndefined();
  });
});

describe('cleanPresets', () => {
  it('keeps usable entries and drops malformed ones', () => {
    const raw = [{ name: 'ok', constants: C() }, { name: 1 }, null, { name: 'half', constants: { l1: 'x' } }, 'junk'];
    expect(cleanPresets(raw).map((x) => x.name)).toEqual(['ok']);
    expect(cleanPresets(undefined)).toEqual([]);
    expect(cleanPresets({})).toEqual([]);
  });
});
