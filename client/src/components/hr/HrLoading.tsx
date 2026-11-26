import { Spinner } from '@/ui';
import s from './HrLoading.module.css';

/** Estado de carga de RH con el Spinner del sistema de diseño y texto visible. */
export default function HrLoading({ text = 'Cargando…' }: { text?: string }) {
    return (
        <p className={s.loading} role="status">
            <Spinner size={18} label={text} />
            <span aria-hidden="true">{text}</span>
        </p>
    );
}
