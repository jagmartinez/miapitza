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
it('remapea los tokens heredados a los nuevos', () => {
  const css = read('./tokens.css');
  expect(css).toMatch(/--color-primary:\s*var\(--ui-primary\)/);
  expect(css).toMatch(/--color-surface:\s*var\(--ui-surface\)/);
  expect(css).toMatch(/--dialog-accent:\s*var\(--ui-primary\)/);
});
