import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './primitives.css';

type Pos = { top: number; left: number; placement: 'top' | 'bottom' };
const GAP = 6;
const EDGE = 8;

/**
 * Tooltip accesible: aparece con hover o foco, en un portal (no lo recortan tablas con scroll)
 * y se reubica abajo o hacia dentro si no cabe en la ventana.
 */
export function Tooltip({ label, children }: { label: ReactNode; children: ReactElement }) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const bubble = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 250);
  }, []);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    const a = anchor.current.getBoundingClientRect();
    const b = bubble.current.getBoundingClientRect();
    const placement: Pos['placement'] = a.top - b.height - GAP < EDGE ? 'bottom' : 'top';
    const top = placement === 'top' ? a.top - b.height - GAP : a.bottom + GAP;
    const left = Math.min(Math.max(a.left + a.width / 2 - b.width / 2, EDGE), window.innerWidth - b.width - EDGE);
    setPos({ top, left, placement });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open, hide]);

  if (!isValidElement(children)) return children;
  const child = children as ReactElement<Record<string, unknown>>;
  const chain = (name: string, fn: () => void) => (e: unknown) => {
    (child.props[name] as ((ev: unknown) => void) | undefined)?.(e);
    fn();
  };

  return (
    <>
      {cloneElement(child, {
        ref: (node: HTMLElement | null) => { anchor.current = node; },
        onMouseEnter: chain('onMouseEnter', show),
        onMouseLeave: chain('onMouseLeave', hide),
        onFocus: chain('onFocus', show),
        onBlur: chain('onBlur', hide),
        onClick: chain('onClick', hide),
        'aria-describedby': open ? id : (child.props['aria-describedby'] as string | undefined),
      })}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={bubble}
              id={id}
              role="tooltip"
              className={`ui-tooltip ui-tooltip--${pos?.placement ?? 'top'}`}
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
