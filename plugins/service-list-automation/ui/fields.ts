import type { Settings } from './settings';

export type FieldKind = 'number' | 'text' | 'bool' | 'choice' | 'column' | 'overrides';

export interface FieldDef {
  /** Dotted path into `Settings`. */
  path: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
}

export interface SectionDef {
  id: string;
  title: string;
  description?: string;
  /** Collapsed by default: rarely touched. */
  advanced?: boolean;
  fields: FieldDef[];
}

const col = (key: string, label: string): FieldDef => ({ path: `csv.columns.${key}`, label, kind: 'column' });
const id = (key: string, label: string): FieldDef => ({ path: `form.ids.${key}`, label, kind: 'text' });

export const SECTIONS: SectionDef[] = [
  {
    id: 'chrome',
    title: 'Chrome',
    description: 'How the plugin opens and finds its Chrome window.',
    fields: [
      { path: 'connection.port', label: 'Debug port', kind: 'number', min: 1, max: 65535, hint: 'Chrome listens here for the plugin. Change it if another program uses the port.' },
      { path: 'connection.urlContains', label: 'Only use the tab whose URL contains', kind: 'text', hint: 'Leave empty to use the first tab.' },
      { path: 'connection.chromePath', label: 'Chrome path', kind: 'text', hint: 'Empty = auto-detect Chrome, Chromium or Edge.' },
    ],
  },
  {
    id: 'csv',
    title: 'CSV',
    description: 'Which column holds which field. Columns are numbered from 1.',
    fields: [
      { path: 'csv.skipHeader', label: 'First line is a header', kind: 'bool' },
      {
        path: 'csv.autoDetect',
        label: 'Match columns by header name',
        kind: 'bool',
        hint: 'With a header row, columns are found by name (e.g. “BU Group code L2”) and the numbers below are only the fallback for a field the header does not name.',
      },
      col('mid', 'MID'),
      col('serviceCode', 'Service code'),
      col('serviceDescription', 'Service description'),
      col('merchantName', 'Merchant name'),
      col('l2', 'L2'),
      col('l3', 'L3'),
      col('l4', 'L4'),
      col('l6', 'L6'),
    ],
  },
  {
    id: 'values',
    title: 'Vertical overrides',
    description: 'Which “New vertical” a row selects. (L1, L5, Group Code L1 and Special project are set per run, on the Run screen.)',
    fields: [
      {
        path: 'form.verticalOverrides',
        label: 'Vertical overrides',
        kind: 'overrides',
        hint: 'One per line, as L3=Vertical. A row whose L3 matches (ignoring case) selects that vertical; any other row selects its own L3.',
      },
    ],
  },
  {
    id: 'behavior',
    title: 'Behaviour',
    fields: [
      {
        path: 'behavior.inputMode',
        label: 'Input mode',
        kind: 'choice',
        options: [
          { value: 'trusted', label: 'Trusted' },
          { value: 'script', label: 'Script' },
        ],
        hint: 'Trusted types and clicks like a person. Use Script only if the page mishandles that.',
      },
      {
        path: 'behavior.optionMatch',
        label: 'Option matching',
        kind: 'choice',
        options: [
          { value: 'exact', label: 'Exact' },
          { value: 'ignoreCase', label: 'Ignore case' },
          { value: 'contains', label: 'Contains' },
        ],
        hint: 'How a CSV value is matched to a dropdown option’s visible text.',
      },
      { path: 'behavior.bringToFrontOnStart', label: 'Bring Chrome to the front when a run starts', kind: 'bool', hint: 'Once, at the start. After that, switching to another window does not interrupt the run.' },
      { path: 'behavior.timeoutMs', label: 'Step timeout (ms)', kind: 'number', min: 100, hint: 'How long to wait for each element, option or dialog.' },
      { path: 'behavior.closeTimeoutMs', label: 'Dialog close timeout (ms)', kind: 'number', min: 100, hint: 'How long to wait for the dialog to close after submit.' },
      { path: 'behavior.readyTimeoutMs', label: 'Page ready timeout (ms)', kind: 'number', min: 100, hint: 'How long to wait at the start for the page to finish loading.' },
      { path: 'behavior.maxConsecutiveFailures', label: 'Stop after failed rows in a row', kind: 'number', min: 0, hint: '0 = never stop on failures.' },
      { path: 'behavior.dryRunHoldMs', label: 'Dry run: show filled form for (ms)', kind: 'number', min: 0, hint: 'The dry-run switch itself is on the Run screen and is on every time the plugin opens.' },
      { path: 'behavior.afterSubmitSettleMs', label: 'Pause after each submit (ms)', kind: 'number', min: 0, hint: 'Lets the page finish refreshing before the next row.' },
      { path: 'behavior.dialogOpenWaitMs', label: 'Wait for the dialog before clicking Create again (ms)', kind: 'number', min: 100 },
      { path: 'behavior.createAttempts', label: 'Create clicks to try per row', kind: 'number', min: 1, max: 10, hint: '1 = never click again. A click can be lost while the page refreshes.' },
    ],
  },
  {
    id: 'outcome',
    title: 'Results',
    description: 'How the tool tells a created row from a duplicate or a rejection, by reading what the page shows after Create.',
    fields: [
      {
        path: 'outcome.onDuplicate',
        label: 'When a row is a duplicate',
        kind: 'choice',
        options: [
          { value: 'skip', label: 'Skip it and continue' },
          { value: 'stop', label: 'Stop the run' },
        ],
      },
      { path: 'outcome.skipFileDuplicates', label: 'Skip a service code repeated in the file', kind: 'bool', hint: 'Only its first row is submitted; the page is never asked about the repeats.' },
      { path: 'outcome.duplicatePattern', label: 'A message means “duplicate” if it matches', kind: 'text', hint: 'Regular expression, case-insensitive, tested against the page’s error message.' },
      { path: 'outcome.confirmWaitMs', label: 'Look for the success message for (ms)', kind: 'number', min: 0, hint: 'After the dialog closes. Without a success message the row is marked “not confirmed”.' },
      { path: 'outcome.successSelectors', label: 'Success message (CSS selectors)', kind: 'text' },
      { path: 'outcome.errorSelectors', label: 'Error message (CSS selectors)', kind: 'text' },
    ],
  },
  {
    id: 'ids',
    title: 'Page element IDs',
    description: 'APEX-generated ids. Change them only if the page changes.',
    advanced: true,
    fields: [
      id('create', 'Create button'),
      id('serviceCode', 'Service code'),
      id('serviceDescription', 'Service description'),
      id('merchant', 'Merchant'),
      id('l1', 'L1'),
      id('l2', 'L2'),
      id('l3', 'L3'),
      id('l4', 'L4'),
      id('l5', 'L5'),
      id('l6', 'L6'),
      id('groupCodeL1', 'Group code L1'),
      id('vertical', 'Vertical'),
      id('project', 'Special project'),
      id('check', 'Confirm checkbox'),
      id('submit', 'Submit button'),
    ],
  },
];

/** Every path any field edits — used by tests to check the screen covers `Settings`. */
export const FIELD_PATHS = SECTIONS.flatMap((s) => s.fields.map((f) => f.path));

export type { Settings };
