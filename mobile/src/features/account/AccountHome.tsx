import type { Session } from '../../core/session';

export function AccountHome({ session, onLogout }: { session: Session; onLogout: () => void }) {
    return (
        <main>
            <header className="top-bar">
                <span>{session.user.name}</span>
                <button type="button" className="btn" onClick={onLogout}>Salir</button>
            </header>
            <p className="muted" style={{ padding: 16 }}>Mi cuenta (próximamente)</p>
        </main>
    );
}
