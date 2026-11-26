import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const ALLOWLIST_PATH = fileURLToPath(new URL('./legacy-allowlist.json', import.meta.url));

type Rule = 'nativeSelect' | 'rawTable' | 'reactSelectImport' | 'toFixedInJsx';
type Allowlist = Record<Rule, string[]>;

const JSX_LINE = /<\/|\/>|<[A-Za-z]|^\s*\{/;
const RULES: Record<Rule, (line: string) => boolean> = {
  nativeSelect: (l) => /<select[\s>]/.test(l),
  rawTable: (l) => /<table[\s>]/.test(l),
  reactSelectImport: (l) => /from\s+['"]react-select(\/[\w-]+)?['"]/.test(l),
  // Heurística: `.toFixed(` en una línea de JSX; los números se muestran con formatNumber/formatMoney.
  toFixedInJsx: (l) => l.includes('.toFixed(') && JSX_LINE.test(l),
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (full === join(SRC, 'ui')) continue;
      walk(full, out);
    } else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function scan(): Allowlist {
  const found: Allowlist = { nativeSelect: [], rawTable: [], reactSelectImport: [], toFixedInJsx: [] };
  for (const file of walk(SRC)) {
    const rel = 'src/' + relative(SRC, file).split(sep).join('/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (const rule of Object.keys(RULES) as Rule[]) {
      if (lines.some((l) => RULES[rule](l))) found[rule].push(rel);
    }
  }
  for (const rule of Object.keys(found) as Rule[]) found[rule].sort();
  return found;
}

// Una sola vez (o al reducir la lista): UI_WRITE_ALLOWLIST=1 npx vitest run src/ui/no-legacy
if (process.env.UI_WRITE_ALLOWLIST === '1') {
  writeFileSync(ALLOWLIST_PATH, JSON.stringify(scan(), null, 2) + '\n');
}

const allow: Allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
const actual = scan();

describe('guardas de consistencia del design system', () => {
  for (const rule of Object.keys(RULES) as Rule[]) {
    it(`${rule}: ningún archivo nuevo viola la regla`, () => {
      const offenders = actual[rule].filter((f) => !allow[rule].includes(f));
      expect(offenders, `Usa los componentes de @/ui o agrega el archivo a legacy-allowlist.json (${rule})`).toEqual([]);
    });
    it(`${rule}: la allowlist no conserva archivos ya migrados`, () => {
      const stale = allow[rule].filter((f) => !actual[rule].includes(f));
      expect(stale, `Quita de legacy-allowlist.json (${rule}) los archivos que ya cumplen`).toEqual([]);
    });
  }
});

describe('clases de botón heredadas', () => {
  it('ningún className usa btn / btn-primary / btn-secondary / btn-danger / btn-ghost / btn-sm|md|lg', () => {
    const LEGACY_BTN = /className=(?:"[^"]*|'[^']*|\{[^}]*["'`][^"'`]*)(?<![\w-])btn(?:-(?:primary|secondary|danger|ghost|sm|md|lg))?(?![\w-])/;
    const offenders = walk(SRC)
      .filter((f) => readFileSync(f, 'utf8').split(/\r?\n/).some((l) => LEGACY_BTN.test(l)))
      .map((f) => relative(SRC, f).split(sep).join('/'));
    expect(offenders, 'Usa Button de @/ui o las clases ui-button ui-button--*').toEqual([]);
  });
});
