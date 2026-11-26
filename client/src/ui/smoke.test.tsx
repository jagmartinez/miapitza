// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { UI_VERSION } from '@/ui';

it('resuelve el alias @/ui y renderiza en jsdom', () => {
  render(<span>{UI_VERSION}</span>);
  expect(screen.getByText('1')).toBeInTheDocument();
});
