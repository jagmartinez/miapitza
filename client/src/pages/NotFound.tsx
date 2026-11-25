import { useNavigate } from 'react-router-dom';
import { Home, SearchX } from 'lucide-react';
import { Button, EmptyState } from '@/ui';
import './NotFound.css';

export default function NotFound() {
    const navigate = useNavigate();

    return (
        <main className="not-found-page">
            <h1 className="sr-only">Página no encontrada</h1>
            <EmptyState
                icon={SearchX}
                title="Página no encontrada"
                description="La ruta que buscas no existe o fue movida."
                action={
                    <Button variant="primary" icon={Home} onClick={() => navigate('/dashboard')}>
                        Ir al inicio
                    </Button>
                }
            />
        </main>
    );
}
