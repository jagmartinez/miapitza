import { useNavigate } from 'react-router-dom';
import { Home, SearchX } from 'lucide-react';
import Button from '../components/Button';
import './NotFound.css';

export default function NotFound() {
    const navigate = useNavigate();

    return (
        <div className="not-found-page">
            <SearchX size={64} aria-hidden="true" />
            <h1>Página no encontrada</h1>
            <p>La ruta que buscas no existe o fue movida.</p>
            <Button variant="primary" onClick={() => navigate('/dashboard')}>
                <Home size={18} aria-hidden="true" />
                Ir al inicio
            </Button>
        </div>
    );
}
