import type { Session } from '../../core/session';

export function WaiterHome({ session, onSwitchUser }: { session: Session; onSwitchUser: () => void }) {
    return (
        <main>
            <header className="top-bar">
                <span>{session.user.name}</span>
                <button type="button" className="btn" onClick={onSwitchUser}>Cambiar usuario</button>
            </header>
            <p className="muted" style={{ padding: 16 }}>Servicio (próximamente)</p>
        </main>
    );
}
