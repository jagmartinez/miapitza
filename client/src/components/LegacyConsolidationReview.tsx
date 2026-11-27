import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSearch, Loader2, ShieldAlert } from 'lucide-react';
import type {
    LegacyTableConsolidationCandidate,
    LegacyTableConsolidationInventory,
} from '../types';
import { Button, Drawer, Field, LoadErrorState, Textarea } from '@/ui';
import './LegacyConsolidationReview.css';

interface LegacyConsolidationReviewProps {
    inventory: LegacyTableConsolidationInventory | null;
    loading: boolean;
    error: string | null;
    actionError: string | null;
    markingCandidateKey: string | null;
    onRetry: () => void;
    onMark: (candidate: LegacyTableConsolidationCandidate, note: string) => Promise<boolean>;
}

const reasonLabels: Record<string, string> = {
    ORIGINAL_ORDER_FINANCIALS_AND_STATUS_WERE_NOT_SNAPSHOTTED:
        'No existe una instantánea confiable de los estados y montos originales.',
    TABLE_CONSOLIDATE_AUDIT_MISSING:
        'Falta la auditoría original que permitiría reconstruir la consolidación.',
};

function classificationLabel(candidate: LegacyTableConsolidationCandidate) {
    return candidate.classification === 'NOT_REVERSIBLE'
        ? 'No reversible automáticamente'
        : 'Ambigua · requiere evidencia externa';
}

export default function LegacyConsolidationReview({
    inventory,
    loading,
    error,
    actionError,
    markingCandidateKey,
    onRetry,
    onMark,
}: LegacyConsolidationReviewProps) {
    const [editingCandidateKey, setEditingCandidateKey] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);

    useEffect(() => {
        if (
            editingCandidateKey
            && !inventory?.candidates.some(
                (candidate) => (
                    candidate.candidateKey === editingCandidateKey
                    && !candidate.currentEvidenceReviewed
                ),
            )
        ) {
            setEditingCandidateKey(null);
            setNote('');
            setValidationError(null);
        }
    }, [editingCandidateKey, inventory]);

    const cancelEditing = () => {
        setEditingCandidateKey(null);
        setNote('');
        setValidationError(null);
    };

    const submitReview = async (candidate: LegacyTableConsolidationCandidate) => {
        const trimmedNote = note.trim();
        if (trimmedNote.length < 5) {
            setValidationError('Describe la revisión con al menos 5 caracteres.');
            return;
        }
        setValidationError(null);
        if (await onMark(candidate, trimmedNote)) {
            setEditingCandidateKey(null);
            setNote('');
        }
    };

    const editingCandidate = inventory?.candidates.find(
        (candidate) => candidate.candidateKey === editingCandidateKey && !candidate.currentEvidenceReviewed,
    ) ?? null;
    const isMarking = editingCandidate !== null && markingCandidateKey === editingCandidate.candidateKey;

    if (loading) {
        return (
            <div className="legacy-review-state" role="status" aria-live="polite">
                <Loader2 className="animate-spin" size={22} aria-hidden="true" />
                <strong>Analizando consolidaciones históricas…</strong>
                <span>Se comparan auditorías, órdenes, vínculos y evidencia persistida.</span>
            </div>
        );
    }

    if (error) {
        return (
            <LoadErrorState message={error} onRetry={onRetry} />
        );
    }

    if (!inventory) return null;

    return (
        <div className="legacy-review">
            <div className="legacy-review-warning" role="note">
                <ShieldAlert size={22} aria-hidden="true" />
                <div>
                    <strong>Estos registros son históricos y no reversibles desde esta pantalla</strong>
                    <span>
                        Registrar una revisión sólo deja trazabilidad. No restaura órdenes, productos,
                        pagos ni mesas.
                    </span>
                </div>
            </div>

            <dl className="legacy-review-summary" aria-label="Resumen del inventario histórico">
                <div><dt>No reversibles</dt><dd>{inventory.summary.notReversible}</dd></div>
                <div><dt>Ambiguas</dt><dd>{inventory.summary.ambiguous}</dd></div>
                <div><dt>Revisadas</dt><dd>{inventory.summary.reviewed}</dd></div>
                <div><dt>Evidencia cambió</dt><dd>{inventory.summary.evidenceChangedAfterReview}</dd></div>
            </dl>

            {actionError && (
                <div className="legacy-review-action-error" role="alert">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div>
                        <strong>No se pudo registrar la revisión</strong>
                        <span>{actionError}</span>
                    </div>
                </div>
            )}

            {inventory.candidates.length === 0 ? (
                <div className="legacy-review-empty">
                    <CheckCircle2 size={28} aria-hidden="true" />
                    <strong>No se detectaron consolidaciones legadas pendientes de inventario.</strong>
                </div>
            ) : (
                <div className="legacy-review-candidates">
                    {inventory.candidates.map((candidate) => {
                        return (
                            <article
                                key={candidate.candidateKey}
                                className={`legacy-review-card ${candidate.classification.toLowerCase()}`}
                            >
                                <header>
                                    <FileSearch size={20} aria-hidden="true" />
                                    <div>
                                        <strong>
                                            {candidate.primaryOrderId
                                                ? `Consolidación histórica de orden #${candidate.primaryOrderId}`
                                                : 'Consolidación histórica sin orden principal verificable'}
                                        </strong>
                                        <span>{classificationLabel(candidate)}</span>
                                    </div>
                                </header>

                                <p>
                                    Órdenes absorbidas:{' '}
                                    {candidate.absorbedOrderIds.length
                                        ? candidate.absorbedOrderIds.map((id) => `#${id}`).join(', ')
                                        : 'sin identificación confiable'}
                                </p>
                                <ul>
                                    {candidate.reasons.map((reason) => (
                                        <li key={reason}>{reasonLabels[reason] ?? `Validación fallida: ${reason}`}</li>
                                    ))}
                                </ul>

                                {candidate.review && (
                                    <div className="legacy-review-record" role="status">
                                        <CheckCircle2 size={18} aria-hidden="true" />
                                        <div>
                                            <strong>
                                                {candidate.currentEvidenceReviewed
                                                    ? `Evidencia actual revisada · revisión #${candidate.review.revision}`
                                                    : `Revisión previa #${candidate.review.revision}`}
                                            </strong>
                                            <span>{candidate.review.note}</span>
                                            <small>
                                                {new Date(candidate.review.reviewedAt).toLocaleString('es-NI')}
                                                {' · '}
                                                {candidate.reviewHistoryCount}{' '}
                                                {candidate.reviewHistoryCount === 1
                                                    ? 'revisión histórica registrada'
                                                    : 'revisiones históricas registradas'}
                                            </small>
                                            {candidate.review.evidenceChangedAfterReview && (
                                                <em>
                                                    La evidencia cambió después de esta revisión; el registro anterior
                                                    no certifica el estado actual. Registra una nueva revisión para
                                                    la huella vigente.
                                                </em>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {!candidate.currentEvidenceReviewed && (
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        disabled={markingCandidateKey !== null}
                                        onClick={() => {
                                            setEditingCandidateKey(candidate.candidateKey);
                                            setNote('');
                                            setValidationError(null);
                                        }}
                                    >
                                        {candidate.review?.evidenceChangedAfterReview
                                            ? 'Registrar nueva revisión de la evidencia actual'
                                            : 'Registrar revisión'}
                                    </Button>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}
            <Drawer
                isOpen={editingCandidate !== null}
                onClose={() => { if (!isMarking) cancelEditing(); }}
                title="Registrar revisión"
                footer={(
                    <>
                        <Button type="button" variant="ghost" disabled={isMarking} onClick={cancelEditing}>
                            Cancelar
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            loading={isMarking}
                            disabled={note.trim().length < 5}
                            onClick={() => editingCandidate && void submitReview(editingCandidate)}
                        >
                            {isMarking ? 'Registrando…' : 'Registrar revisión sin reversar'}
                        </Button>
                    </>
                )}
            >
                {editingCandidate && (
                    <Field
                        label="Nota de revisión obligatoria"
                        htmlFor={`legacy-review-note-${editingCandidate.candidateKey}`}
                        error={validationError ?? undefined}
                        required
                    >
                        <Textarea
                            id={`legacy-review-note-${editingCandidate.candidateKey}`}
                            value={note}
                            minLength={5}
                            maxLength={1000}
                            rows={6}
                            required
                            disabled={isMarking}
                            onChange={(event) => {
                                setNote(event.target.value);
                                if (validationError) setValidationError(null);
                            }}
                            placeholder={
                                editingCandidate.classification === 'NOT_REVERSIBLE'
                                    ? 'Documenta por qué se reconoce sin reverso automático'
                                    : 'Documenta la evidencia externa que aún debe obtenerse'
                            }
                        />
                    </Field>
                )}
            </Drawer>
        </div>
    );
}
