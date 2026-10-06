import type { Settings } from './settings';

export type Constants = Settings['form']['constants'];

/** A named set of the fixed form values, kept to reuse later. */
export interface Preset {
  name: string;
  constants: Constants;
}

const MAX_PRESETS = 50;
const MAX_NAME = 60;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Saved state may be missing or malformed (older version, hand edit): keep what is usable. */
export function cleanPresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p): Preset[] => {
    const c = (p as Preset | null)?.constants;
    if (typeof (p as Preset | null)?.name !== 'string' || !c) return [];
    const ok = (['l1', 'l5', 'groupCodeL1', 'project'] as const).every((k) => typeof c[k] === 'string');
    return ok ? [{ name: p.name, constants: { l1: c.l1, l5: c.l5, groupCodeL1: c.groupCodeL1, project: c.project } }] : [];
  });
}

/** Add a preset, or replace the one with the same name (ignoring case). */
export function savePreset(presets: Preset[], name: string, constants: Constants): Preset[] {
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean) return presets;
  const rest = presets.filter((p) => !same(p.name, clean));
  return [...rest, { name: clean, constants: { ...constants } }].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_PRESETS);
}

export const deletePreset = (presets: Preset[], name: string): Preset[] => presets.filter((p) => !same(p.name, name));

/** The saved preset whose values equal `constants`, if any — so the picker can show it as selected. */
export function matchingPreset(presets: Preset[], constants: Constants): Preset | undefined {
  return presets.find((p) => (Object.keys(constants) as (keyof Constants)[]).every((k) => p.constants[k] === constants[k]));
}
