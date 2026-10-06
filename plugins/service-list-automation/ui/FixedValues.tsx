import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deletePreset, matchingPreset, savePreset, type Constants, type Preset } from './presets';
import { DEFAULT_SETTINGS } from './settings';

interface Props {
  constants: Constants;
  onChange: (next: Constants) => void;
  presets: Preset[];
  onPresets: (next: Preset[]) => void;
  disabled?: boolean;
}

const FIELDS: { key: keyof Constants; label: string }[] = [
  { key: 'l1', label: 'L1' },
  { key: 'l5', label: 'L5' },
  { key: 'groupCodeL1', label: 'Group Code L1' },
  { key: 'project', label: 'Special project' },
];

const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } as const;
const selectStyle = {
  height: 30,
  padding: '0 6px',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  border: '1px solid var(--line, rgba(128,128,128,0.4))',
  fontSize: 12,
} as const;

/** The four values every row shares. At rest: one line to read, plus the saved-set
 *  picker when there is something to pick. Editing, saving and resetting only
 *  appear after "Edit". */
export function FixedValues({ constants, onChange, presets, onPresets, disabled }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const current = matchingPreset(presets, constants);
  const isDefault = FIELDS.every((f) => constants[f.key] === DEFAULT_SETTINGS.form.constants[f.key]);

  const picker = presets.length > 0 && (
    <select
      style={selectStyle}
      disabled={disabled}
      value={current?.name ?? ''}
      onChange={(e) => {
        const p = presets.find((x) => x.name === e.target.value);
        if (p) onChange({ ...p.constants });
      }}
    >
      <option value="" disabled>
        Saved sets…
      </option>
      {presets.map((p) => (
        <option key={p.name} value={p.name}>
          {p.name}
        </option>
      ))}
    </select>
  );

  if (!editing) {
    return (
      <div style={row}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13 }}>
          {FIELDS.map((f) => (
            <span key={f.key}>
              <span style={{ opacity: 0.55, fontSize: 11, marginRight: 4 }}>{f.label}</span>
              {constants[f.key] || <em style={{ opacity: 0.6 }}>empty</em>}
            </span>
          ))}
        </div>
        <div style={{ ...row, marginLeft: 'auto' }}>
          {current && <span style={{ fontSize: 11, opacity: 0.6 }}>set “{current.name}”</span>}
          {picker}
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </div>
    );
  }

  const save = () => {
    if (!name.trim()) return;
    onPresets(savePreset(presets, name, constants));
    setName('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        {FIELDS.map((f) => (
          <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            {f.label}
            <Input value={constants[f.key]} onChange={(e) => onChange({ ...constants, [f.key]: e.target.value })} />
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11, opacity: 0.65 }}>Type each value exactly as the page’s dropdown shows it.</div>
      <div style={row}>
        {picker}
        <Input
          style={{ width: 180, height: 30 }}
          value={name}
          placeholder="Save as set…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <Button size="sm" variant="outline" disabled={!name.trim()} onClick={save}>
          Save set
        </Button>
        {current && (
          <Button size="sm" variant="ghost" onClick={() => onPresets(deletePreset(presets, current.name))}>
            Delete “{current.name}”
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={isDefault} onClick={() => onChange({ ...DEFAULT_SETTINGS.form.constants })}>
          Reset
        </Button>
        <Button size="sm" style={{ marginLeft: 'auto' }} onClick={() => setEditing(false)}>
          Done
        </Button>
      </div>
    </div>
  );
}
