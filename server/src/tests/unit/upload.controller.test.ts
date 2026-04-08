import { describe, expect, it } from '@jest/globals';
import { sanitizeLogoFilename } from '../../controllers/upload.controller';

describe('sanitizeLogoFilename', () => {
  it('accepts generated logo filenames with allowed extensions', () => {
    expect(sanitizeLogoFilename('logo-1712345678-123456789.png')).toBe('logo-1712345678-123456789.png');
  });

  it('rejects path traversal attempts', () => {
    expect(sanitizeLogoFilename('../logo-1712345678-123456789.png')).toBeNull();
  });

  it('rejects svg uploads even if the name matches the prefix', () => {
    expect(sanitizeLogoFilename('logo-1712345678-123456789.svg')).toBeNull();
  });
});
