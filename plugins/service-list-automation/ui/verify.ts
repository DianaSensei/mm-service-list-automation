import type { MappingEntry, ServiceRow } from './api';
import type { Settings } from './settings';

/** One line of the "does this match the form?" table, in the order the form shows them. */
export interface CheckItem {
  /** The label of the field on the page. */
  label: string;
  kind: 'csv' | 'fixed' | 'derived' | 'untouched';
  /** Where the value comes from, in words. */
  source: string;
  /** The value for each sample row (the same for every row when `fixed`). */
  samples: string[];
  /** Something the user should look at twice. */
  warning?: string;
}

export interface Checklist {
  items: CheckItem[];
  /** CSV columns no form field uses. */
  unused: { column: number; header: string }[];
}

/** The vertical to select for a row: an override matching L3 (ignoring case), else L3. */
export function verticalFor(l3: string, overrides: Record<string, string>): string {
  const hit = Object.entries(overrides).find(([k]) => k.toLowerCase() === l3.toLowerCase());
  return hit ? hit[1] : l3;
}

const src = (m: MappingEntry) =>
  `column ${m.column}${m.header ? ` “${m.header}”` : ''}${m.detected ? '' : ' — NOT found by header name, using the configured column'}`;

export function buildChecklist(mapping: MappingEntry[], header: string[], rows: ServiceRow[], s: Settings, sampleCount = 2): Checklist {
  const sample = rows.slice(0, sampleCount);
  const entry = (f: MappingEntry['field']) => mapping.find((m) => m.field === f);
  const csv = (label: string, f: Exclude<MappingEntry['field'], 'mid'>): CheckItem => {
    const m = entry(f);
    return {
      label,
      kind: 'csv',
      source: m ? src(m) : 'unmapped',
      samples: sample.map((r) => r[f]),
      warning: m && !m.detected && header.length > 0 ? 'The header has no column with this name.' : undefined,
    };
  };
  const fixed = (label: string, value: string): CheckItem => ({
    label,
    kind: 'fixed',
    source: 'fixed value (Settings → Fixed form values)',
    samples: sample.map(() => value),
  });
  const untouched = (label: string): CheckItem => ({
    label,
    kind: 'untouched',
    source: 'not set by the tool — left exactly as the page has it',
    samples: sample.map(() => '—'),
  });
  const c = s.form.constants;

  const items: CheckItem[] = [
    csv('Service Code', 'serviceCode'),
    csv('Service Description', 'serviceDescription'),
    untouched('Accounting Code'),
    csv('Merchant', 'merchantName'),
    untouched('Department name'),
    fixed('BU Group Code L1', c.l1),
    csv('BU Group Code L2', 'l2'),
    csv('BU Group Code L3', 'l3'),
    csv('BU Group Code L4', 'l4'),
    fixed('BU Group Code L5', c.l5),
    csv('BU Group Code L6', 'l6'),
    fixed('Group Code L1', c.groupCodeL1),
    {
      label: 'New vertical',
      kind: 'derived',
      source: 'same as L3, except the overrides in Settings (e.g. GROCERY → GROCERY - OTHER)',
      samples: sample.map((r) => verticalFor(r.l3, s.form.verticalOverrides)),
    },
    fixed('Special project', c.project),
    fixed('“I want to create this service code”', 'ticked'),
  ];

  const used = new Set(mapping.filter((m) => m.field !== 'mid').map((m) => m.column));
  // The tool never reads MID: no field on the form takes it.
  const unused = header
    .map((h, i) => ({ column: i + 1, header: h }))
    .filter((c2) => !used.has(c2.column));
  return { items, unused };
}

/** One row exactly as it will be entered, field by field, for the preview popup. */
export interface PreviewRow {
  /** 1-based row number in the file's data rows. */
  n: number;
  values: Record<PreviewColumn, string>;
  /** Earlier row (1-based) with the same service code: this one will be skipped. */
  duplicateOf?: number;
}

export const PREVIEW_COLUMNS = [
  'Service Code',
  'Service Description',
  'Merchant',
  'L1',
  'L2',
  'L3',
  'L4',
  'L5',
  'L6',
  'Group Code L1',
  'New vertical',
  'Special project',
] as const;
export type PreviewColumn = (typeof PREVIEW_COLUMNS)[number];

/** What each row will put in the form. `skipFileDuplicates` mirrors the sidecar:
 *  a code seen earlier in the file (trimmed, ignoring case) is not submitted again. */
export function buildPreview(rows: ServiceRow[], s: Settings, skipFileDuplicates = true): PreviewRow[] {
  const c = s.form.constants;
  const firstSeen = new Map<string, number>();
  return rows.map((r, i) => {
    const key = r.serviceCode.trim().toLowerCase();
    const earlier = key ? firstSeen.get(key) : undefined;
    if (key && earlier === undefined) firstSeen.set(key, i + 1);
    return {
      n: i + 1,
      duplicateOf: skipFileDuplicates ? earlier : undefined,
      values: {
        'Service Code': r.serviceCode,
        'Service Description': r.serviceDescription,
        Merchant: r.merchantName,
        L1: c.l1,
        L2: r.l2,
        L3: r.l3,
        L4: r.l4,
        L5: c.l5,
        L6: r.l6,
        'Group Code L1': c.groupCodeL1,
        'New vertical': verticalFor(r.l3, s.form.verticalOverrides),
        'Special project': c.project,
      },
    };
  });
}
