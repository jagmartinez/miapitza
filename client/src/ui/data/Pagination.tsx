import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../primitives/IconButton';
import { AppSelect } from '../forms/AppSelect';
import './data.css';

type Props = {
  page: number;
  pageSize: number;
  total: number;
  pageSizeOptions?: number[];
  onChange(page: number, pageSize: number): void;
  label?: string;
  /** Oculta el selector de filas por página (adaptadores heredados sin cambio de tamaño). */
  hidePageSize?: boolean;
  /** Reemplaza el texto de rango. */
  infoText?: string;
};

/** Hasta 7 elementos: números y elipsis (null). */
function pageItems(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, null, pages];
  if (page >= pages - 3) return [1, null, pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, null, page - 1, page, page + 1, null, pages];
}

export function Pagination({ page, pageSize, total, pageSizeOptions = [10, 25, 50, 100], onChange, label = 'Paginación', hidePageSize, infoText }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const text = total === 0 ? '0 resultados' : `${start}–${end} de ${total}`;

  return (
    <nav className="ui-pagination" aria-label={label}>
      <span className="ui-pagination__info" aria-live="polite">{infoText ?? text}</span>
      <div className="ui-pagination__controls">
      {hidePageSize ? null : (
        <div className="ui-pagination__size">
          <span aria-hidden="true">Filas</span>
          <AppSelect<number>
            size="sm"
            aria-label="Filas por página"
            isClearable={false}
            isSearchable={false}
            options={pageSizeOptions.map((n) => ({ value: n, label: String(n) }))}
            value={pageSize}
            onChange={(v) => v != null && onChange(1, v)}
          />
        </div>
      )}
      <div className="ui-pagination__pages">
        <IconButton size="sm" icon={ChevronLeft} label="Página anterior" disabled={page <= 1} onClick={() => onChange(page - 1, pageSize)} />
        {pageItems(page, pages).map((p, i) =>
          p === null ? (
            <span key={`e${i}`} className="ui-pagination__ellipsis" aria-hidden="true">…</span>
          ) : (
            <button
              key={p}
              type="button"
              className={`ui-pagination__page ${p === page ? 'is-active' : ''}`}
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Página ${p}`}
              onClick={() => onChange(p, pageSize)}
            >
              {p}
            </button>
          ),
        )}
        <IconButton size="sm" icon={ChevronRight} label="Página siguiente" disabled={page >= pages} onClick={() => onChange(page + 1, pageSize)} />
      </div>
      </div>
    </nav>
  );
}
