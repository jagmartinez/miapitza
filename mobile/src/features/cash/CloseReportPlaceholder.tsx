import './cash.css';

/** Route target after a successful close until Task 7 builds the close report (replace this component). */
export default function CloseReportPlaceholder({ shiftId, onDone }: { shiftId: number; onDone: () => void }) {
    return (
        <main className="cash" data-testid="cash-report" data-shift={shiftId}>
            <header className="cash-bar">
                <strong className="cash-title">Turno cerrado</strong>
            </header>
            <p className="muted cash-notice">El reporte de cierre llega en la siguiente tarea.</p>
            <div className="cash-foot">
                <button type="button" className="btn btn-primary cash-main" onClick={onDone}>
                    Listo
                </button>
            </div>
        </main>
    );
}
