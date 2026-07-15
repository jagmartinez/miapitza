import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentDirectory = new URL('./', import.meta.url);
const pageDirectory = new URL('../../pages/hr/', import.meta.url);

function readTsx(directory: URL): string {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => readFileSync(new URL(name, directory), 'utf8'))
    .join('\n');
}

const hrSource = `${readTsx(componentDirectory)}\n${readTsx(pageDirectory)}`;
const selectAdapter = readFileSync(new URL('./HrReactSelect.tsx', import.meta.url), 'utf8');
const moneyInput = readFileSync(new URL('./HrMoneyInput.tsx', import.meta.url), 'utf8');
const moneyInputFormat = readFileSync(new URL('./hrMoneyInputFormat.ts', import.meta.url), 'utf8');
const sharedStyles = readFileSync(new URL('../../pages/hr/hr-ui.css', import.meta.url), 'utf8');
const catering = readFileSync(new URL('../../pages/Catering.tsx', import.meta.url), 'utf8');

describe('RH and Catering UI design-system contract', () => {
  it('keeps RH views inside the shared 1700px content boundary', () => {
    expect(sharedStyles).toContain(".page-wrapper[class*='hr-']");
    expect(sharedStyles).toContain('max-width: 1700px');
    expect(sharedStyles).toContain('margin-inline: auto');
  });

  it('uses the project React Select adapter instead of native selects in RH', () => {
    expect(hrSource).not.toMatch(/<\/?select\b/);
    expect(selectAdapter).toContain("import Select from '../Select'");
    expect(hrSource).toContain('<HrReactSelect');
  });

  it('normalizes monetary input while presenting thousands separators and right alignment', () => {
    expect(moneyInputFormat).toContain("replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')");
    expect(moneyInput).toContain('className={`hr-money-input');
    expect(sharedStyles).toContain('font-variant-numeric: tabular-nums');
  });

  it('does not restore the removed Catering event intro', () => {
    expect(catering).not.toContain('catering-event-intro');
    expect(catering).not.toContain('animate-slide-in');
  });
});
