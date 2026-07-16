import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogA11y } from '../hooks/useDialogA11y';
import './NumericKeypad.css';

interface NumericKeypadProps {
    onConfirm: (quantity: number) => void;
    onClose: () => void;
    initialValue?: number;
    closeOnOverlayClick?: boolean;
}

export default function NumericKeypad({ onConfirm, onClose, initialValue = 1, closeOnOverlayClick = false }: NumericKeypadProps) {
    const [display, setDisplay] = useState(initialValue.toString());
    const dialogRef = useRef<HTMLDivElement>(null);
    const { titleId } = useDialogA11y(true, onClose, dialogRef);

    const handleNumber = (num: string) => {
        if (display === '0') {
            setDisplay(num);
        } else if (display.length < 3) {
            setDisplay(display + num);
        }
    };

    const handleClear = () => {
        setDisplay('1');
    };

    const handleBackspace = () => {
        if (display.length > 1) {
            setDisplay(display.slice(0, -1));
        } else {
            setDisplay('1');
        }
    };

    const handleConfirm = () => {
        const qty = parseInt(display);
        if (qty > 0 && qty <= 999) {
            onConfirm(qty);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key >= '0' && e.key <= '9') {
            handleNumber(e.key);
        } else if (e.key === 'Enter') {
            handleConfirm();
        } else if (e.key === 'Backspace') {
            handleBackspace();
        }
    };

    return createPortal(
        <div className="keypad-overlay" onClick={closeOnOverlayClick ? onClose : undefined}>
            <div
                ref={dialogRef}
                className="keypad-container"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleKeyPress}
            >
                <div className="keypad-header">
                    <div className="keypad-heading">
                        <h3 id={titleId}>Cantidad</h3>
                    </div>
                    <button type="button" onClick={onClose} className="keypad-close" aria-label="Cerrar selector de cantidad">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                <output className="keypad-display" aria-live="polite" aria-label={`Cantidad ${display}`}>{display}</output>

                <div className="keypad-grid">
                    {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(num => (
                        <button
                            key={num}
                            type="button"
                            aria-label={`Agregar ${num}`}
                            onClick={() => handleNumber(num.toString())}
                            className="keypad-btn"
                        >
                            {num}
                        </button>
                    ))}
                    <button type="button" onClick={handleClear} className="keypad-btn keypad-clear" aria-label="Limpiar cantidad">
                        C
                    </button>
                    <button type="button" onClick={() => handleNumber('0')} className="keypad-btn" aria-label="Agregar 0">
                        0
                    </button>
                    <button type="button" onClick={handleBackspace} className="keypad-btn keypad-backspace" aria-label="Borrar último dígito">
                        ⌫
                    </button>
                </div>

                <button type="button" onClick={handleConfirm} className="keypad-confirm">
                    Confirmar
                </button>
            </div>
        </div>,
        document.body,
    );
}
