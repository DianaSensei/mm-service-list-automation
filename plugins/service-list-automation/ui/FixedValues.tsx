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
  { key: 'l1', label: 'BU Group Code L1' },
  { key: 'l5', label: 'BU Group Code L5' },
  { key: 'groupCodeL1', label: 'Group Code L1' },
  { key: 'project', label: 'Special project' },
];

const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } as const;
const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, flex: 1, minWidth: 170 } as const;
const selectStyle = {
  height: 32,
  padding: '0 8px',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  border: '1px solid currentColor',
  opacity: 0.9,
  minWidth: 180,
} as const;

/** The values that are the same for every row. They are saved as you type (so the
 *  next session starts from them), and can also be kept as named presets. */
export function FixedValues({ constants, onChange, presets, onPresets, disabled }: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const current = matchingPreset(presets, constants);
  const isDefault = FIELDS.every((f) => constants[f.key] === DEFAULT_SETTINGS.form.constants[f.key]);

  const commitName = () => {
    onPresets(savePreset(presets, name, constants));
    setNaming(false);
    setName('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={row}>
        {FIELDS.map((f) => (
          <label key={f.key} style={label}>
            {f.label}
            <Input
              value={constants[f.key]}
              disabled={disabled}
              onChange={(e) => onChange({ ...constants, [f.key]: e.target.value })}
            />
          </label>
        ))}
      </div>

      <div style={row}>
        <span style={{ fontSize: 12 }}>Saved sets</span>
        <select
          style={selectStyle}
          disabled={disabled || presets.length === 0}
          value={current?.name ?? ''}
          onChange={(e) => {
            const p = presets.find((x) => x.name === e.target.value);
            if (p) onChange({ ...p.constants });
          }}
        >
          <option value="" disabled>
            {presets.length === 0 ? 'None saved yet' : current ? '' : 'Choose a saved set…'}
          </option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>

        {naming ? (
          <>
            <Input
              autoFocus
              style={{ width: 200 }}
              value={name}
              placeholder="Name this set"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) commitName();
                if (e.key === 'Escape') setNaming(false);
              }}
            />
            <Button size="sm" disabled={!name.trim()} onClick={commitName}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => setNaming(true)}>
              Save current values as…
            </Button>
            {current && (
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onPresets(deletePreset(presets, current.name))}>
                Delete “{current.name}”
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || isDefault}
              onClick={() => onChange({ ...DEFAULT_SETTINGS.form.constants })}
            >
              Reset to defaults
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
