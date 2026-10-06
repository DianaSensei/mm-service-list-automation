import { describe, expect, it } from 'vitest';
import type { MappingEntry, ServiceRow } from './api';
import { DEFAULT_SETTINGS, setPath } from './settings';
import { buildChecklist, buildPreview, verticalFor } from './verify';

const m = (field: MappingEntry['field'], column: number, header: string | null, detected = true): MappingEntry => ({
  field,
  column,
  header,
  detected,
});
const MAPPING: MappingEntry[] = [
  m('mid', 1, 'MID'),
  m('serviceCode', 2, 'SERVICE_CODE (agent)'),
  m('serviceDescription', 3, 'SERVICE_DESCRIPTION_'),
  m('merchantName', 4, 'MERCHANT (Brand Name)'),
  m('l2', 6, 'BU Group code L2'),
  m('l3', 7, 'BU Group code L3'),
  m('l4', 8, 'BU Group code L4'),
  m('l6', 9, 'BU Group code L6'),
];
const HEADER = ['MID', 'SERVICE_CODE (agent)', 'SERVICE_DESCRIPTION_', 'MERCHANT (Brand Name)', 'CATEGORY', 'BU Group code L2', 'BU Group code L3', 'BU Group code L4', 'BU Group code L6'];
const row = (o: Partial<ServiceRow>): ServiceRow => ({
  mid: 'M', serviceCode: 'sc', serviceDescription: 'd', merchantName: 'n', l2: 'FNB', l3: 'BEVERAGE', l4: 'MILK TEA', l6: 'FIXED LOCATION', ...o,
});

describe('verticalFor', () => {
  it('uses L3 unless an override matches, ignoring case', () => {
    const o = { GROCERY: 'GROCERY - OTHER' };
    expect(verticalFor('grocery', o)).toBe('GROCERY - OTHER');
    expect(verticalFor('BEVERAGE', o)).toBe('BEVERAGE');
    expect(verticalFor('x', {})).toBe('x');
  });
});

describe('buildChecklist', () => {
  const list = buildChecklist(MAPPING, HEADER, [row({}), row({ l3: 'GROCERY' })], DEFAULT_SETTINGS);

  it('lists the form fields in the order the page shows them', () => {
    expect(list.items.map((i) => i.label)).toEqual([
      'Service Code', 'Service Description', 'Accounting Code', 'Merchant', 'Department name',
      'BU Group Code L1', 'BU Group Code L2', 'BU Group Code L3', 'BU Group Code L4', 'BU Group Code L5',
      'BU Group Code L6', 'Group Code L1', 'New vertical', 'Special project', '“I want to create this service code”',
    ]);
  });

  it('shows the value each sample row will put in each field', () => {
    const by = (l: string) => list.items.find((i) => i.label === l)!;
    expect(by('BU Group Code L2').samples).toEqual(['FNB', 'FNB']);
    expect(by('BU Group Code L2').source).toContain('column 6');
    expect(by('BU Group Code L1').samples).toEqual(['SME OFFLINE', 'SME OFFLINE']);
    expect(by('New vertical').samples).toEqual(['BEVERAGE', 'GROCERY - OTHER']);
  });

  it('says plainly which fields the tool does not touch', () => {
    const untouched = list.items.filter((i) => i.kind === 'untouched').map((i) => i.label);
    expect(untouched).toEqual(['Accounting Code', 'Department name']);
  });

  it('points out CSV columns no field uses (MID and CATEGORY here)', () => {
    expect(list.unused).toEqual([
      { column: 1, header: 'MID' },
      { column: 5, header: 'CATEGORY' },
    ]);
  });

  it('warns about a field that was not found by header name', () => {
    const l = buildChecklist([...MAPPING.filter((x) => x.field !== 'l4'), m('l4', 8, 'x', false)], HEADER, [row({})], DEFAULT_SETTINGS);
    const l4 = l.items.find((i) => i.label === 'BU Group Code L4')!;
    expect(l4.warning).toBeTruthy();
    expect(l4.source).toContain('NOT found by header name');
    expect(list.items.every((i) => !i.warning)).toBe(true);
  });
});

describe('buildPreview', () => {
  const rows = [row({ serviceCode: 'A1' }), row({ serviceCode: ' a1 ', l3: 'GROCERY' }), row({ serviceCode: 'B2' }), row({ serviceCode: '' }), row({ serviceCode: '' })];
  const p = buildPreview(rows, DEFAULT_SETTINGS);

  it('shows every row with the values it will enter, fixed ones included', () => {
    expect(p).toHaveLength(5);
    expect(p[0].values).toMatchObject({ 'Service Code': 'A1', L1: 'SME OFFLINE', L2: 'FNB', L5: 'OTHER', 'Group Code L1': 'PAYMENT', 'New vertical': 'BEVERAGE' });
    expect(p[1].values['New vertical']).toBe('GROCERY - OTHER');
  });

  it('flags a code already used earlier in the file, like the run will', () => {
    expect(p.map((x) => x.duplicateOf)).toEqual([undefined, 1, undefined, undefined, undefined]);
    expect(buildPreview(rows, DEFAULT_SETTINGS, false).every((x) => x.duplicateOf === undefined)).toBe(true);
  });

  it('reflects the fixed values currently set', () => {
    expect(buildPreview(rows, setPath(DEFAULT_SETTINGS, 'form.constants.project', 'P2'))[0].values['Special project']).toBe('P2');
  });
});
