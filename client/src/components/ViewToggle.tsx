import { LayoutGrid, List } from 'lucide-react';
import type { ViewMode } from '../hooks/useViewMode';
import './CatalogView.css';

interface ViewToggleProps {
    value: ViewMode;
    onChange: (mode: ViewMode) => void;
}

/** Cards / table view switcher used across catalog views. */
export default function ViewToggle({ value, onChange }: ViewToggleProps) {
    return (
        <div className="view-toggle catalog-view-toggle">
            <button
                type="button"
                className={`view-toggle-btn ${value === 'cards' ? 'active' : ''}`}
                onClick={() => onChange('cards')}
                title="Vista de tarjetas"
                aria-label="Vista de tarjetas"
                aria-pressed={value === 'cards'}
            >
                <LayoutGrid size={18} />
            </button>
            <button
                type="button"
                className={`view-toggle-btn ${value === 'table' ? 'active' : ''}`}
                onClick={() => onChange('table')}
                title="Vista de tabla"
                aria-label="Vista de tabla"
                aria-pressed={value === 'table'}
            >
                <List size={18} />
            </button>
        </div>
    );
}
