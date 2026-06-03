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
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const closeOnEscape = options?.closeOnEscape ?? true;
    const lockScroll = options?.lockScroll ?? true;

    // Run only when the dialog opens/closes — not when onClose identity changes on parent re-render.
    useEffect(() => {
        if (!isOpen) return;

        previousFocusRef.current = document.activeElement as HTMLElement | null;

        if (lockScroll) {
            document.body.style.overflow = 'hidden';
        }

        const container = containerRef.current;
        if (container) {
            const focusables = getFocusableElements(container);
            const firstField = focusables.find(
                (el) => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
            );
            (firstField ?? focusables[0] ?? container).focus();
        }

        return () => {
            if (lockScroll) {
                document.body.style.overflow = 'unset';
            }
            previousFocusRef.current?.focus?.();
        };
    }, [isOpen, containerRef, lockScroll]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (closeOnEscape && event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
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
        };
    }, [isOpen, containerRef, closeOnEscape]);

    return { titleId, descriptionId };
}
