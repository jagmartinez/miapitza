import type { CSSProperties } from 'react';
import './primitives.css';

export function Skeleton({
  width = '100%',
  height = 16,
  className = '',
}: {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  className?: string;
}) {
  return <span className={`ui-skeleton ${className}`.trim()} aria-hidden="true" style={{ width, height }} />;
}
