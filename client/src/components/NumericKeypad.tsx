import { useState } from 'react';
import { X } from 'lucide-react';
import './NumericKeypad.css';

interface NumericKeypadProps {
    onConfirm: (quantity: number) => void;
    onClose: () => void;
    initialValue?: number;
    closeOnOverlayClick?: boolean;
}

export default function NumericKeypad({ onConfirm, onClose, initialValue = 1, closeOnOverlayClick = false }: NumericKeypadProps) {
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

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key >= '0' && e.key <= '9') {
            handleNumber(e.key);
        } else if (e.key === 'Enter') {
            handleConfirm();
        } else if (e.key === 'Escape') {
            onClose();
        } else if (e.key === 'Backspace') {
            handleBackspace();
        }
    };

    return (
        <div className="keypad-overlay" onClick={closeOnOverlayClick ? onClose : undefined}>
            <div className="keypad-container" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyPress}>
                <div className="keypad-header">
                    <h3>Cantidad</h3>
                    <button onClick={onClose} className="keypad-close">
                        <X size={20} />
                    </button>
                </div>

                <div className="keypad-display">{display}</div>

                <div className="keypad-grid">
                    {[7, 8, 9, 4, 5, 6, 1, 2, 3].map(num => (
                        <button
                            key={num}
                            onClick={() => handleNumber(num.toString())}
                            className="keypad-btn"
                        >
                            {num}
                        </button>
                    ))}
                    <button onClick={handleClear} className="keypad-btn keypad-clear">
                        C
                    </button>
                    <button onClick={() => handleNumber('0')} className="keypad-btn">
                        0
                    </button>
                    <button onClick={handleBackspace} className="keypad-btn keypad-backspace">
                        ⌫
                    </button>
                </div>

                <button onClick={handleConfirm} className="keypad-confirm">
                    Confirmar
                </button>
            </div>
        </div>
    );
}
