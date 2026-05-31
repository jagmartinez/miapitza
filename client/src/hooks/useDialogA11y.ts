import { useEffect, useId, useRef, type RefObject } from 'react';

const FOCUSABLE =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        el => el.offsetParent !== null || el === document.activeElement
    );
}

export function useDialogA11y(
    isOpen: boolean,
    onClose: () => void,
    containerRef: RefObject<HTMLElement | null>,
    options?: { closeOnEscape?: boolean; lockScroll?: boolean }
) {
    const titleId = useId();
    const descriptionId = useId();
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const closeOnEscape = options?.closeOnEscape ?? true;
    const lockScroll = options?.lockScroll ?? true;

    useEffect(() => {
        if (!isOpen) return;

        previousFocusRef.current = document.activeElement as HTMLElement | null;

        if (lockScroll) {
            document.body.style.overflow = 'hidden';
        }

        const container = containerRef.current;
        if (container) {
            const focusables = getFocusableElements(container);
            (focusables[0] ?? container).focus();
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (closeOnEscape && event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
            }

            if (event.key !== 'Tab' || !containerRef.current) return;

            const focusables = getFocusableElements(containerRef.current);
            if (focusables.length === 0) {
                event.preventDefault();
                return;
            }

            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement as HTMLElement;

            if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            if (lockScroll) {
                document.body.style.overflow = 'unset';
            }
            previousFocusRef.current?.focus?.();
        };
    }, [isOpen, onClose, containerRef, closeOnEscape, lockScroll]);

    return { titleId, descriptionId };
}
