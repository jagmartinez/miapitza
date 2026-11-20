import type { ActionOpts, CashApi } from '../../data/cashApi';
import type { CashShiftInfo, MovementInput } from '../../data/cashTypes';
import type { Session } from '../../core/session';
import type { CountMode } from './CashHome';

export interface ActiveShiftProps {
    api: Pick<CashApi, 'summary'>;
    session: Session;
    shift: CashShiftInfo;
    requiresClose?: boolean;
    closeMessage?: string | null;
    addMovement: (shiftId: number, input: MovementInput, opts?: ActionOpts) => Promise<unknown>;
    onBack: () => void;
    onCount: (shiftId: number, mode: CountMode) => void;
}

/** Placeholder until the full active shift screen lands (Task 5). */
export function ActiveShiftScreen({ shift, onBack, onCount }: ActiveShiftProps) {
    return (
        <main className="cash" data-testid="active-shift">
            <header className="cash-bar">
                <button type="button" className="btn" aria-label="Volver" onClick={onBack}>
                    ←
                </button>
                <strong className="cash-title">{shift.cashRegister?.name ?? 'Caja'}</strong>
            </header>
            <footer className="cash-foot">
                <button type="button" className="btn btn-primary cash-main" onClick={() => onCount(shift.id, 'close')}>
                    Cerrar turno
                </button>
            </footer>
        </main>
    );
}
