import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SECTIONS, type FieldDef } from './fields';
import {
  DEFAULT_SETTINGS,
  formatOverrides,
  getPath,
  isDefault,
  parseOverrides,
  setPath,
  type Settings,
} from './settings';

export interface ProfileInfo {
  profileDir: string;
  exists: boolean;
  chromePath: string | null;
}

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  /** Where the tool's Chrome stores its profile; null while it is being looked up. */
  profile: ProfileInfo | null;
}

const fieldBox = { display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0' } as const;
const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } as const;

function clamp(n: number, f: FieldDef): number {
  const lo = f.min ?? Number.MIN_SAFE_INTEGER;
  const hi = f.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function showDefault(f: FieldDef): string {
  const d = getPath(DEFAULT_SETTINGS, f.path);
  if (f.kind === 'column') return `column ${(d as number) + 1}`;
  if (f.kind === 'overrides') return formatOverrides(d as Record<string, string>).replace(/\n/g, '; ') || '(none)';
  if (f.kind === 'bool') return d ? 'on' : 'off';
  if (f.kind === 'choice') return f.options?.find((o) => o.value === d)?.label ?? String(d);
  return d === '' ? '(empty)' : String(d);
}

/** Free text is edited locally and committed parsed, so a half-typed line
 *  ("GROCERY") is not thrown away while the user is still typing it. */
function OverridesEditor({ value, onCommit }: { value: Record<string, string>; onCommit: (m: Record<string, string>) => void }) {
  const [text, setText] = useState(() => formatOverrides(value));
  return (
    <Textarea
      rows={3}
      value={text}
      placeholder="GROCERY=GROCERY - OTHER"
      onChange={(e) => {
        setText(e.target.value);
        onCommit(parseOverrides(e.target.value));
      }}
    />
  );
}

function Control({ f, settings, onChange }: { f: FieldDef; settings: Settings; onChange: (v: unknown) => void }) {
  const value = getPath(settings, f.path);
  switch (f.kind) {
    case 'bool':
      return <Switch checked={value === true} onCheckedChange={onChange} />;
    case 'choice':
      return <Segmented value={String(value)} options={f.options ?? []} onValueChange={onChange} size="sm" />;
    case 'number':
      return (
        <Input
          type="number"
          style={{ width: 140 }}
          value={String(value)}
          onChange={(e) => {
            const n = Number(e.target.value);
            // An emptied or nonsensical box means "back to the default".
            onChange(e.target.value === '' || Number.isNaN(n) ? getPath(DEFAULT_SETTINGS, f.path) : clamp(n, f));
          }}
        />
      );
    case 'column':
      return (
        <Input
          type="number"
          style={{ width: 100 }}
          value={String((value as number) + 1)}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(e.target.value === '' || Number.isNaN(n) ? getPath(DEFAULT_SETTINGS, f.path) : clamp(n, { ...f, min: 1 }) - 1);
          }}
        />
      );
    case 'overrides':
      return <OverridesEditor value={value as Record<string, string>} onCommit={onChange} />;
    default:
      return <Input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function SettingsScreen({ settings, onChange, profile }: Props) {
  // Bumped on reset so locally-edited fields (the overrides box) re-read their value.
  const [epoch, setEpoch] = useState(0);
  const set = (path: string, v: unknown) => onChange(setPath(settings, path, v));
  const reset = (path: string) => {
    onChange(setPath(settings, path, structuredClone(getPath(DEFAULT_SETTINGS, path))));
    setEpoch((n) => n + 1);
  };
  const anyChanged = SECTIONS.some((s) => s.fields.some((f) => !isDefault(settings, f.path)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, opacity: 0.8 }}>
          Every value has a default; a field that differs shows it and can be reset on its own.
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!anyChanged}
          onClick={() => {
            // What the Run screen owns — the page URL and this run's fixed values — is not
            // a tuning parameter: keep it.
            const fresh = structuredClone(DEFAULT_SETTINGS);
            onChange({
              ...fresh,
              connection: { ...fresh.connection, url: settings.connection.url },
              form: { ...fresh.form, constants: settings.form.constants },
            });
            setEpoch((n) => n + 1);
          }}
        >
          Reset all to defaults
        </Button>
      </div>

      <ChromeProfile profile={profile} />

      {SECTIONS.map((section) => (
        <CollapsibleSection key={section.id} title={section.title} hint={section.description} defaultOpen={!section.advanced} variant="bordered">
          <div key={epoch} style={{ display: 'flex', flexDirection: 'column' }}>
            {section.fields.map((f) => {
              const changed = !isDefault(settings, f.path);
              return (
                <div key={f.path} style={fieldBox}>
                  <div style={rowStyle}>
                    <span style={{ fontSize: 12, minWidth: 210 }}>{f.label}</span>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <Control f={f} settings={settings} onChange={(v) => set(f.path, v)} />
                    </div>
                    {changed && (
                      <Button variant="ghost" size="sm" onClick={() => reset(f.path)} title={`Default: ${showDefault(f)}`}>
                        Reset
                      </Button>
                    )}
                  </div>
                  {(f.hint || changed) && (
                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                      {f.hint}
                      {changed ? `${f.hint ? ' ' : ''}Default: ${showDefault(f)}.` : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      ))}
    </div>
  );
}

/** Read-only: where the sign-in lives, and which Chrome is started. */
function ChromeProfile({ profile }: { profile: ProfileInfo | null }) {
  return (
    <CollapsibleSection
      title="Chrome profile"
      hint="The tool’s Chrome keeps its sign-in and cookies here, separate from your everyday Chrome."
      defaultOpen
      variant="bordered"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 0' }}>
        <div style={rowStyle}>
          <span style={{ fontSize: 12, minWidth: 210 }}>Profile folder</span>
          <Input
            readOnly
            style={{ flex: 1, minWidth: 260, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            value={profile ? profile.profileDir : 'Looking up…'}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          {profile && !profile.exists ? 'Not created yet: it appears the first time Chrome is opened from the tool. ' : ''}
          To sign out completely, close Chrome from the tool and delete this folder.
        </div>
        <div style={rowStyle}>
          <span style={{ fontSize: 12, minWidth: 210 }}>Chrome used</span>
          <span style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
            {profile ? (profile.chromePath ?? 'not found — set “Chrome path” below') : '…'}
          </span>
        </div>
      </div>
    </CollapsibleSection>
  );
}
