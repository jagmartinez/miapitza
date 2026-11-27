import { useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { Button, FullScreenModal } from '@/ui';
import './NumericKeypad.css';

interface NumericKeypadProps {
    onConfirm: (quantity: number) => void;
    onClose: () => void;
    initialValue?: number;
}

export default function NumericKeypad({ onConfirm, onClose, initialValue = 1 }: NumericKeypadProps) {
    const [display, setDisplay] = useState(initialValue.toString());

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

    const handleKeyPress = (e: KeyboardEvent) => {
        if (e.key >= '0' && e.key <= '9') {
            handleNumber(e.key);
        } else if (e.key === 'Enter') {
            // Enter sobre un botón enfocado (p. ej. Cancelar) ejecuta ese botón, no la confirmación.
            if ((e.target as HTMLElement).closest('button')) return;
            handleConfirm();
        } else if (e.key === 'Backspace') {
            handleBackspace();
        }
    };

    // El diálogo del kit enfoca su propio contenedor: el teclado se escucha a nivel de documento.
    const keyHandlerRef = useRef(handleKeyPress);
    keyHandlerRef.current = handleKeyPress;
    useEffect(() => {
        const listener = (e: KeyboardEvent) => keyHandlerRef.current(e);
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
    }, []);

    return (
        <FullScreenModal
            isOpen
            size="compact"
            title="Cantidad"
            onClose={onClose}
            footer={({ requestClose }) => (
                <>
                    <Button variant="secondary" onClick={requestClose}>Cancelar</Button>
                    <Button variant="primary" onClick={handleConfirm}>Confirmar</Button>
                </>
            )}
        >
            <div className="keypad-container">
                <output className="keypad-display" aria-live="polite" aria-label={`Cantidad ${display}`}>{display}</output>

                <div className="keypad-grid">
                    {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(num => (
                        <Button
                            key={num}
                            size="lg"
                            variant="secondary"
                            aria-label={`Agregar ${num}`}
                            onClick={() => handleNumber(num.toString())}
                            className="keypad-btn"
                        >
                            {num}
                        </Button>
                    ))}
                    <Button size="lg" variant="secondary" onClick={handleClear} className="keypad-btn keypad-btn--muted" aria-label="Limpiar cantidad">
                        C
                    </Button>
                    <Button size="lg" variant="secondary" onClick={() => handleNumber('0')} className="keypad-btn" aria-label="Agregar 0">
                        0
                    </Button>
                    <Button size="lg" variant="secondary" icon={Delete} onClick={handleBackspace} className="keypad-btn keypad-btn--muted" aria-label="Borrar último dígito" />
                </div>
            </div>
        </FullScreenModal>
    );
}
