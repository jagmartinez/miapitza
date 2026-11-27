import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
function block(css: string, selector: string): string {
  const re = new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{`);
  const m = re.exec(css);
  if (!m) return '';
  const start = m.index + m[0].length;
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

const TOKENS = ['--ui-bg','--ui-surface','--ui-surface-2','--ui-border','--ui-text','--ui-text-muted','--ui-primary','--ui-primary-hover','--ui-primary-fg','--ui-primary-soft','--ui-success','--ui-success-soft','--ui-warning','--ui-warning-soft','--ui-danger','--ui-danger-soft','--ui-overlay'];

it('define cada token de color en :root y en .dark', () => {
  const css = read('./tokens.css');
  const root = block(css, ':root'); const dark = block(css, '.dark');
  for (const t of TOKENS) { expect(root).toContain(`${t}:`); expect(dark).toContain(`${t}:`); }
});
it('usa los valores aprobados', () => {
  expect(block(read('./tokens.css'), ':root')).toMatch(/--ui-primary:\s*#3451d1/i);
  expect(block(read('./tokens.css'), '.dark')).toMatch(/--ui-primary:\s*#8ea2ff/i);
});
it('ya no define alias --color-* y conserva los alias de diálogo', () => {
  const css = read('./tokens.css');
  expect(css).not.toMatch(/--color-[a-z-]+:/);
  expect(css).toMatch(/--dialog-accent:\s*var\(--ui-primary\)/);
});

it('los CSS del kit usan solo tokens: sin hex, rgb/hsl ni white/black literales fuera de tokens.css', async () => {
  const { readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = fileURLToPath(new URL('.', import.meta.url));
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.css') && e.name !== 'tokens.css') files.push(f);
    }
  };
  walk(root);
  const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|:\s*(?:white|black)\b|\s(?:white|black)\s*[;,)]/i;
  const offenders = files.flatMap((f) =>
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .filter((l) => LITERAL.test(l.replace(/white-space:[^;]+;/g, '')))
      .map((l) => `${f}: ${l.trim()}`),
  );
  expect(offenders).toEqual([]);
});

it('define los tokens de sombra, foco y texto sobre color en ambos temas', () => {
  const css = read('./tokens.css');
  const root = block(css, ':root'); const dark = block(css, '.dark');
  for (const t of ['--ui-shadow-overlay', '--ui-focus-ring', '--ui-danger-fg', '--ui-success-fg']) {
    expect(root).toContain(`${t}:`);
    expect(dark).toContain(`${t}:`);
  }
});
