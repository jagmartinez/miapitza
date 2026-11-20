import type { Session } from '../../core/session';

export function KitchenHome({ session }: { session: Session }) {
    return (
        <main>
            <header className="top-bar">
                <span>Cocina</span>
                <span className="muted">{session.user.name}</span>
            </header>
            <p className="muted" style={{ padding: 16 }}>Pantalla de cocina (próximamente)</p>
        </main>
    );
}
