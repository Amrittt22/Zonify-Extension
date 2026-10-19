import { useEffect, useState } from 'react';
import { MinusIcon, PlusIcon } from '../components/icons';
import { checkHealth, normalizeApiUrl } from '../lib/api';
import { useStorageValue } from '../lib/hooks';
import { DEFAULT_SETTINGS, STORAGE_KEYS, setSettings } from '../lib/storage';
import { clamp } from '../lib/timer';
import type { Settings } from '../lib/types';

interface StepperProps {
  label: string;
  hint?: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function Stepper({ label, hint, value, unit, min, max, step, onChange }: StepperProps) {
  const change = (delta: number) => onChange(clamp(value + delta, min, max));
  return (
    <div className="setting-row">
      <span className="setting-row__label">
        {label}
        {hint && <span className="setting-row__desc">{hint}</span>}
      </span>
      <div className="stepper">
        <button
          type="button"
          className="icon-btn"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => change(-step)}
        >
          <MinusIcon />
        </button>
        <span className="stepper__value" aria-live="polite">
          {value} {unit}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => change(step)}
        >
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}

interface SwitchProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ label, hint, checked, onChange }: SwitchProps) {
  return (
    <div className="setting-row">
      <span className="setting-row__label" id={`switch-label-${label.replace(/\s+/g, '-').toLowerCase()}`}>
        {label}
        {hint && <span className="setting-row__desc">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-labelledby={`switch-label-${label.replace(/\s+/g, '-').toLowerCase()}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
      </button>
    </div>
  );
}

export function TimerTab() {
  const settings = useStorageValue<Settings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS, (stored) => ({
    ...DEFAULT_SETTINGS,
    ...stored,
  }));

  const [urlDraft, setUrlDraft] = useState(settings.insightsApiUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [probe, setProbe] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    setUrlDraft(settings.insightsApiUrl);
  }, [settings.insightsApiUrl]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    void setSettings({ ...settings, [key]: value });
  };

  const commitUrl = () => {
    const normalized = normalizeApiUrl(urlDraft);
    if (!normalized) {
      setUrlError('Enter a URL like http://localhost:8787');
      return;
    }
    setUrlError(null);
    setProbe('idle');
    setUrlDraft(normalized);
    if (normalized !== settings.insightsApiUrl) update('insightsApiUrl', normalized);
  };

  const testConnection = async () => {
    const normalized = normalizeApiUrl(urlDraft);
    if (!normalized) {
      setUrlError('Enter a URL like http://localhost:8787');
      return;
    }
    setProbe('checking');
    setProbe((await checkHealth(normalized)) ? 'ok' : 'fail');
  };

  return (
    <div className="tab-stack">
      <section className="card">
        <h2 className="card__title">Durations</h2>
        <Stepper
          label="Focus"
          value={settings.focus}
          unit="min"
          min={1}
          max={90}
          step={1}
          onChange={(v) => update('focus', v)}
        />
        <Stepper
          label="Short break"
          value={settings.short}
          unit="min"
          min={1}
          max={30}
          step={1}
          onChange={(v) => update('short', v)}
        />
        <Stepper
          label="Long break"
          value={settings.long}
          unit="min"
          min={1}
          max={45}
          step={1}
          onChange={(v) => update('long', v)}
        />
        <Stepper
          label="Sessions before long break"
          value={settings.sessionsBeforeLong}
          unit=""
          min={2}
          max={8}
          step={1}
          onChange={(v) => update('sessionsBeforeLong', v)}
        />
      </section>

      <section className="card">
        <h2 className="card__title">Behavior</h2>
        <Toggle
          label="Auto-start breaks"
          hint="A break begins the moment a focus session ends."
          checked={settings.autoStartBreaks}
          onChange={(v) => update('autoStartBreaks', v)}
        />
        <Toggle
          label="Auto-start focus"
          hint="A new focus session begins when a break ends."
          checked={settings.autoStartFocus}
          onChange={(v) => update('autoStartFocus', v)}
        />
        <Toggle
          label="Sound when session ends"
          hint="Plays the system notification sound."
          checked={settings.sound}
          onChange={(v) => update('sound', v)}
        />
        <Toggle
          label="Desktop notifications"
          hint="One notification each time a session finishes."
          checked={settings.notifications}
          onChange={(v) => update('notifications', v)}
        />
      </section>

      <section className="card">
        <h2 className="card__title">AI insights</h2>
        <Toggle
          label="Weekly insight"
          hint="Sends aggregate weekly numbers to your Zonify server for a short AI-written summary. Off by default."
          checked={settings.insightsEnabled}
          onChange={(v) => update('insightsEnabled', v)}
        />

        {settings.insightsEnabled && (
          <>
            <div className="setting-row setting-row--stack">
              <label className="setting-row__label" htmlFor="insights-url">
                Server URL
                <span className="setting-row__desc">
                  Where the Zonify backend runs, e.g. http://localhost:8787
                </span>
              </label>
              <input
                id="insights-url"
                className="field"
                value={urlDraft}
                spellCheck={false}
                placeholder="http://localhost:8787"
                onChange={(event) => {
                  setUrlDraft(event.target.value);
                  setProbe('idle');
                  if (urlError) setUrlError(null);
                }}
                onBlur={commitUrl}
                aria-invalid={urlError ? true : undefined}
                aria-describedby={urlError ? 'insights-url-error' : undefined}
              />
              {urlError && (
                <p className="form-error" id="insights-url-error" role="alert" style={{ margin: 0 }}>
                  {urlError}
                </p>
              )}
            </div>

            <div className="setting-row">
              <span className="setting-row__label">
                Connection
                <span className="setting-row__desc">Pings /health — no stats are sent.</span>
              </span>
              <div className="insight__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => void testConnection()}
                  disabled={probe === 'checking'}
                >
                  {probe === 'checking' ? 'Checking…' : 'Test connection'}
                </button>
                <span className="insight__stamp" aria-live="polite">
                  {probe === 'ok' && <span className="muted">Reachable</span>}
                  {probe === 'fail' && <span className="form-error" style={{ margin: 0 }}>No answer</span>}
                </span>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
