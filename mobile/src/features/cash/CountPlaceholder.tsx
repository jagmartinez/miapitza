import './cash.css';

/** Route target of "Cerrar turno" / "Arqueo parcial" until Task 6 builds the count screen (replace this component). */
export default function CountPlaceholder({ shiftId, mode, onBack }: { shiftId: number; mode: 'partial' | 'close'; onBack: () => void }) {
    return (
        <main className="cash" data-testid="cash-count" data-shift={shiftId} data-mode={mode}>
            <header className="cash-bar">
                <button type="button" className="btn" aria-label="Volver" onClick={onBack}>
                    ←
                </button>
                <strong className="cash-title">{mode === 'close' ? 'Cerrar turno' : 'Arqueo parcial'}</strong>
            </header>
            <p className="muted cash-notice">El conteo llega en la siguiente tarea.</p>
        </main>
    );
}
