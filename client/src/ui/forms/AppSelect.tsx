import { useCallback, useEffect, useMemo, useRef } from 'react';
import Select, { type GroupBase, type StylesConfig } from 'react-select';
import AsyncSelect from 'react-select/async';
import CreatableSelect from 'react-select/creatable';
import { appSelectStyles } from './appSelectStyles';

export type Opt<V> = { value: V; label: string; description?: string; isDisabled?: boolean };

type Common = {
  inputId?: string;
  'aria-label'?: string;
  placeholder?: string;
  isClearable?: boolean;
  isDisabled?: boolean;
  size?: 'sm' | 'md';
  invalid?: boolean;
  noOptionsText?: string;
};

export type AppSelectProps<V> = Common &
  (
    | { kind?: 'single'; options: Opt<V>[] | GroupBase<Opt<V>>[]; value: V | null; onChange: (v: V | null) => void }
    | { kind: 'multi'; options: Opt<V>[]; value: V[]; onChange: (v: V[]) => void }
    | {
        kind: 'async';
        loadOptions: (q: string) => Promise<Opt<V>[]>;
        value: Opt<V> | null;
        onChange: (o: Opt<V> | null) => void;
        debounceMs?: number;
      }
    | { kind: 'creatable'; options: Opt<V>[]; value: V | null; onChange: (v: V | null) => void; onCreate: (label: string) => void }
  );

function flatten<V>(options: Opt<V>[] | GroupBase<Opt<V>>[]): Opt<V>[] {
  const out: Opt<V>[] = [];
  for (const o of options as Array<Opt<V> | GroupBase<Opt<V>>>) {
    if ('options' in o) out.push(...o.options);
    else out.push(o);
  }
  return out;
}

function formatOption<V>(o: Opt<V>) {
  if (!o.description) return o.label;
  return (
    <div>
      <div>{o.label}</div>
      <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{o.description}</div>
    </div>
  );
}

export function AppSelect<V>(props: AppSelectProps<V>) {
  const {
    inputId,
    placeholder,
    isDisabled,
    size = 'md',
    invalid = false,
    noOptionsText = 'Sin resultados',
  } = props;
  const kind = props.kind ?? 'single';
  const isClearable = props.isClearable ?? kind === 'single';

  const styles = useMemo<StylesConfig<Opt<V>, boolean, GroupBase<Opt<V>>>>(
    () => ({
      ...appSelectStyles,
      control: (base, state) => {
        const b = appSelectStyles.control!(base, state);
        return {
          ...b,
          minHeight: size === 'sm' ? 32 : 40,
          ...(invalid ? { borderColor: 'var(--ui-danger)', '&:hover': { borderColor: 'var(--ui-danger)' } } : {}),
        };
      },
    }),
    [size, invalid],
  );

  // Debounce local para el modo async.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<((o: Opt<V>[]) => void) | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const asyncLoad = props.kind === 'async' ? props.loadOptions : undefined;
  const debounceMs = props.kind === 'async' ? (props.debounceMs ?? 300) : 0;
  const debouncedLoad = useCallback(
    (q: string) =>
      new Promise<Opt<V>[]>((resolve) => {
        if (timer.current) clearTimeout(timer.current);
        pending.current?.([]);
        pending.current = resolve;
        timer.current = setTimeout(() => {
          pending.current = null;
          asyncLoad!(q).then(resolve, () => resolve([]));
        }, debounceMs);
      }),
    [asyncLoad, debounceMs],
  );

  const shared = {
    inputId,
    'aria-label': props['aria-label'],
    'aria-invalid': invalid || undefined,
    placeholder,
    isDisabled,
    isClearable,
    classNamePrefix: 'app-select',
    menuPortalTarget: typeof document !== 'undefined' ? document.body : null,
    menuPosition: 'fixed' as const,
    styles,
    noOptionsMessage: () => noOptionsText,
    loadingMessage: () => 'Cargando…',
    formatOptionLabel: formatOption<V>,
  };

  if (props.kind === 'multi') {
    const flat = props.options;
    const selected = flat.filter((o) => props.value.includes(o.value));
    return (
      <Select<Opt<V>, true>
        {...shared}
        isMulti
        options={flat}
        value={selected}
        onChange={(v) => props.onChange(v.map((o) => o.value))}
      />
    );
  }

  if (props.kind === 'async') {
    return (
      <AsyncSelect<Opt<V>>
        {...shared}
        cacheOptions
        defaultOptions
        loadOptions={debouncedLoad}
        value={props.value}
        onChange={(o) => props.onChange(o ?? null)}
      />
    );
  }

  if (props.kind === 'creatable') {
    const selected = props.options.find((o) => o.value === props.value) ?? null;
    return (
      <CreatableSelect<Opt<V>>
        {...shared}
        options={props.options}
        value={selected}
        onChange={(o) => props.onChange(o ? o.value : null)}
        onCreateOption={props.onCreate}
        formatCreateLabel={(t) => `Crear "${t}"`}
      />
    );
  }

  const selected = flatten(props.options).find((o) => o.value === props.value) ?? null;
  return (
    <Select<Opt<V>>
      {...shared}
      options={props.options}
      value={selected}
      onChange={(o) => props.onChange(o ? o.value : null)}
    />
  );
}
