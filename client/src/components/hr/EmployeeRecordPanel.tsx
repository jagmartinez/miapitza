import { AppSelect, Badge, Button, DateInput, EmptyState, Field, FormGrid, FormSection, Input, Textarea } from '@/ui';
import HrMoneyInput from './HrMoneyInput';
import { formatHrMoney } from '../../utils/hrDisplay';
import { useCallback, useEffect, useId, useState } from 'react';
import { Download, FileLock2, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
import HrLoading from './HrLoading';
import styles from './hrForm.module.css';
import { getHrErrorMessage, hrClient } from './hrClient';
import type { HrCompensationRecord, HrEmployeeDocument, HrEmploymentContract, HrPayFrequency } from '../../types/hr';

export type EmployeeRecordMode = 'contracts' | 'compensation' | 'documents';

function today(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateText(value?: string | null): string {
    return value ? value.slice(0, 10) : 'Abierto';
}

function frequencyText(value: HrPayFrequency): string {
    return ({
        WEEKLY: 'Semanal · 52 períodos/año',
        BIWEEKLY: 'Quincenal · 24 períodos/año',
        FORTNIGHTLY: 'Catorcenal · 26 períodos/año',
        MONTHLY: 'Mensual · 12 períodos/año',
    })[value];
}

export default function EmployeeRecordPanel({ employeeId, mode }: { employeeId: number; mode: EmployeeRecordMode }) {
    const [contracts, setContracts] = useState<HrEmploymentContract[]>([]);
    const [compensations, setCompensations] = useState<HrCompensationRecord[]>([]);
    const [documents, setDocuments] = useState<HrEmployeeDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [contractForm, setContractForm] = useState({ contractNumber: '', employmentType: 'FULL_TIME', startDate: today(), endDate: '', notes: '' });
    const [transitionForm, setTransitionForm] = useState({ contractId: '', action: 'ACTIVATE' as 'ACTIVATE' | 'TERMINATE' | 'EXPIRE', signedAt: '', endDate: today(), reason: '' });
    const [compensationForm, setCompensationForm] = useState({ contractId: '', compensationType: 'SALARY' as 'SALARY' | 'HOURLY', payFrequency: 'MONTHLY' as HrPayFrequency, amount: '', currency: 'NIO', effectiveFrom: today(), reason: '' });
    const [documentForm, setDocumentForm] = useState<{ documentType: string; expiresAt: string; file: File | null }>({ documentType: '', expiresAt: '', file: null });
    const [revocationReason, setRevocationReason] = useState('');
    const uid = useId();

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            if (mode === 'contracts') setContracts(await hrClient.getEmployeeContracts(employeeId));
            if (mode === 'compensation') {
                const [contractItems, compensationItems] = await Promise.all([
                    hrClient.getEmployeeContracts(employeeId), hrClient.getEmployeeCompensations(employeeId),
                ]);
                setContracts(contractItems);
                setCompensations(compensationItems);
            }
            if (mode === 'documents') setDocuments(await hrClient.getEmployeeDocuments(employeeId));
        } catch (loadError) {
            setError(getHrErrorMessage(loadError, 'No fue posible cargar el historial.'));
        } finally {
            setLoading(false);
        }
    }, [employeeId, mode]);

    useEffect(() => { void load(); }, [load]);

    const mutate = async (operation: () => Promise<unknown>, successMessage: string) => {
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            await operation();
            setMessage(successMessage);
            await load();
        } catch (mutationError) {
            setError(getHrErrorMessage(mutationError, 'La operación no pudo completarse.'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <HrLoading text="Cargando historial…" />;

    const frequencyOptions = [
        { value: 'WEEKLY', label: 'Semanal · 52 períodos/año' },
        { value: 'BIWEEKLY', label: 'Quincenal · 24 períodos/año' },
        { value: 'FORTNIGHTLY', label: 'Catorcenal · 26 períodos/año' },
        { value: 'MONTHLY', label: 'Mensual · 12 períodos/año' },
    ];

    return (
        <div className={styles.form}>
            {error && (
                <div className={`${styles.alertDanger} ${styles.actions}`} role="alert">
                    <ShieldAlert size={16} aria-hidden="true" />
                    <span>{error}</span>
                    <Button variant="ghost" icon={RefreshCw} onClick={() => void load()}>Recargar</Button>
                </div>
            )}
            {message && <div className={styles.alertSuccess} role="status">{message}</div>}

            {mode === 'contracts' && (
                <>
                    <form aria-label="Nuevo contrato" onSubmit={(event) => {
                        event.preventDefault();
                        void mutate(() => hrClient.createEmployeeContract(employeeId, {
                            ...contractForm, endDate: contractForm.endDate || undefined, notes: contractForm.notes || undefined,
                        }), 'Borrador contractual creado; debe activarse con fecha de firma y razón.');
                    }}>
                        <FormSection title="Nuevo contrato">
                            <FormGrid>
                                <Field label="Número" htmlFor={`${uid}-contract-number`} required>
                                    <Input id={`${uid}-contract-number`} value={contractForm.contractNumber} onChange={(event) => setContractForm(current => ({ ...current, contractNumber: event.target.value.toUpperCase() }))} required maxLength={80} />
                                </Field>
                                <Field label="Tipo" htmlFor={`${uid}-contract-type`}>
                                    <AppSelect<string>
                                        inputId={`${uid}-contract-type`}
                                        options={[
                                            { value: 'FULL_TIME', label: 'Tiempo completo' },
                                            { value: 'PART_TIME', label: 'Tiempo parcial' },
                                            { value: 'TEMPORARY', label: 'Temporal' },
                                            { value: 'CONTRACTOR', label: 'Contratista' },
                                            { value: 'INTERN', label: 'Pasantía' },
                                        ]}
                                        value={contractForm.employmentType}
                                        onChange={(next) => setContractForm((current) => ({ ...current, employmentType: next ?? '' }))}
                                        isClearable={false}
                                    />
                                </Field>
                                <Field label="Inicio" htmlFor={`${uid}-contract-start`} required>
                                    <DateInput id={`${uid}-contract-start`} value={contractForm.startDate} onChange={(event) => setContractForm(current => ({ ...current, startDate: event.target.value }))} required />
                                </Field>
                                <Field label="Fin previsto" htmlFor={`${uid}-contract-end`}>
                                    <DateInput id={`${uid}-contract-end`} min={contractForm.startDate} value={contractForm.endDate} onChange={(event) => setContractForm(current => ({ ...current, endDate: event.target.value }))} />
                                </Field>
                            </FormGrid>
                            <Field label="Notas" htmlFor={`${uid}-contract-notes`}>
                                <Textarea id={`${uid}-contract-notes`} value={contractForm.notes} onChange={(event) => setContractForm(current => ({ ...current, notes: event.target.value }))} maxLength={5000} />
                            </Field>
                            <div className={styles.actionsEnd}>
                                <Button variant="primary" icon={Plus} type="submit" loading={saving}>Crear borrador</Button>
                            </div>
                        </FormSection>
                    </form>

                    {contracts.length > 0 && (
                        <form aria-label="Transición controlada" onSubmit={(event) => {
                            event.preventDefault();
                            const contractId = Number(transitionForm.contractId);
                            void mutate(() => hrClient.transitionEmployeeContract(employeeId, contractId, {
                                action: transitionForm.action, reason: transitionForm.reason,
                                signedAt: transitionForm.action === 'ACTIVATE' ? new Date(transitionForm.signedAt).toISOString() : undefined,
                                endDate: transitionForm.action === 'ACTIVATE' ? undefined : transitionForm.endDate,
                            }), 'Transición contractual aplicada y auditada.');
                        }}>
                            <FormSection title="Transición controlada">
                                <FormGrid>
                                    <Field label="Contrato" htmlFor={`${uid}-transition-contract`}>
                                        <AppSelect<string>
                                            inputId={`${uid}-transition-contract`}
                                            options={contracts.map((contract) => ({ value: String(contract.id), label: `${contract.contractNumber} · ${contract.status}` }))}
                                            value={transitionForm.contractId || null}
                                            placeholder="Seleccione"
                                            onChange={(next) => setTransitionForm((current) => ({ ...current, contractId: next ?? '' }))}
                                            isClearable={false}
                                        />
                                    </Field>
                                    <Field label="Acción" htmlFor={`${uid}-transition-action`}>
                                        <AppSelect<string>
                                            inputId={`${uid}-transition-action`}
                                            options={[
                                                { value: 'ACTIVATE', label: 'Activar firmado' },
                                                { value: 'TERMINATE', label: 'Terminar' },
                                                { value: 'EXPIRE', label: 'Expirar' },
                                            ]}
                                            value={transitionForm.action}
                                            onChange={(next) => setTransitionForm((current) => ({ ...current, action: (next ?? '') as typeof current.action }))}
                                            isClearable={false}
                                        />
                                    </Field>
                                    {transitionForm.action === 'ACTIVATE' ? (
                                        <Field label="Fecha/hora de firma" htmlFor={`${uid}-transition-signed`} required>
                                            <Input id={`${uid}-transition-signed`} type="datetime-local" value={transitionForm.signedAt} onChange={(event) => setTransitionForm(current => ({ ...current, signedAt: event.target.value }))} required />
                                        </Field>
                                    ) : (
                                        <Field label="Fecha final" htmlFor={`${uid}-transition-end`} required>
                                            <DateInput id={`${uid}-transition-end`} value={transitionForm.endDate} onChange={(event) => setTransitionForm(current => ({ ...current, endDate: event.target.value }))} required />
                                        </Field>
                                    )}
                                </FormGrid>
                                <Field label="Razón" htmlFor={`${uid}-transition-reason`} required>
                                    <Input id={`${uid}-transition-reason`} value={transitionForm.reason} onChange={(event) => setTransitionForm(current => ({ ...current, reason: event.target.value }))} required minLength={3} maxLength={500} />
                                </Field>
                                <div className={styles.actionsEnd}>
                                    <Button variant="primary" type="submit" loading={saving}>Aplicar transición</Button>
                                </div>
                            </FormSection>
                        </form>
                    )}

                    <RecordList title="Contratos" empty="Sin contratos registrados.">{contracts.map(contract => (
                        <li key={contract.id}>
                            <span className={styles.cellStack}>
                                <span className={styles.cellTitle}>{contract.contractNumber}</span>
                                <span className={styles.cellSub}>{contract.employmentType.replace(/_/g, ' ')} · {dateText(contract.startDate)} a {dateText(contract.endDate)}</span>
                                <span className={styles.cellSub}>{contract.signedAt ? `Firmado ${contract.signedAt}` : 'Pendiente de firma/activación'}</span>
                            </span>
                            <Badge tone="neutral">{contract.status}</Badge>
                        </li>
                    ))}</RecordList>
                </>
            )}

            {mode === 'compensation' && (
                <>
                    <form aria-label="Versionar compensación" onSubmit={(event) => {
                        event.preventDefault();
                        void mutate(() => hrClient.appendEmployeeCompensation(employeeId, {
                            ...compensationForm, contractId: compensationForm.contractId ? Number(compensationForm.contractId) : undefined,
                        }), 'Nueva versión de compensación creada; la anterior quedó cerrada.');
                    }}>
                        <FormSection title="Versionar compensación">
                            <FormGrid>
                                <Field label="Contrato" htmlFor={`${uid}-comp-contract`}>
                                    <AppSelect<string>
                                        inputId={`${uid}-comp-contract`}
                                        options={[
                                            { value: '', label: 'Sin vínculo' },
                                            ...contracts.map((contract) => ({ value: String(contract.id), label: `${contract.contractNumber} · ${contract.status}` })),
                                        ]}
                                        value={compensationForm.contractId}
                                        onChange={(next) => setCompensationForm((current) => ({ ...current, contractId: next ?? '' }))}
                                        isClearable={false}
                                    />
                                </Field>
                                <Field label="Tipo" htmlFor={`${uid}-comp-type`}>
                                    <AppSelect<string>
                                        inputId={`${uid}-comp-type`}
                                        options={[
                                            { value: 'SALARY', label: 'Salario' },
                                            { value: 'HOURLY', label: 'Por hora' },
                                        ]}
                                        value={compensationForm.compensationType}
                                        onChange={(next) => setCompensationForm((current) => ({ ...current, compensationType: (next ?? '') as typeof current.compensationType }))}
                                        isClearable={false}
                                    />
                                </Field>
                                <Field label="Frecuencia" htmlFor={`${uid}-comp-frequency`}>
                                    <AppSelect<string>
                                        inputId={`${uid}-comp-frequency`}
                                        options={frequencyOptions}
                                        value={compensationForm.payFrequency}
                                        onChange={(next) => setCompensationForm((current) => ({ ...current, payFrequency: (next ?? '') as typeof current.payFrequency }))}
                                        isClearable={false}
                                    />
                                </Field>
                                <Field label="Monto" htmlFor={`${uid}-comp-amount`} required>
                                    <HrMoneyInput id={`${uid}-comp-amount`} value={compensationForm.amount} onValueChange={(amount) => setCompensationForm(current => ({ ...current, amount }))} required />
                                </Field>
                                <Field label="Moneda" htmlFor={`${uid}-comp-currency`}>
                                    <AppSelect<string>
                                        inputId={`${uid}-comp-currency`}
                                        options={[
                                            { value: 'NIO', label: 'NIO · Córdoba' },
                                            { value: 'USD', label: 'USD · Dólar' },
                                        ]}
                                        value={compensationForm.currency}
                                        onChange={(next) => setCompensationForm((current) => ({ ...current, currency: next ?? '' }))}
                                        isClearable={false}
                                    />
                                </Field>
                                <Field label="Vigente desde" htmlFor={`${uid}-comp-from`} required>
                                    <DateInput id={`${uid}-comp-from`} value={compensationForm.effectiveFrom} onChange={(event) => setCompensationForm(current => ({ ...current, effectiveFrom: event.target.value }))} required />
                                </Field>
                            </FormGrid>
                            <Field label="Razón" htmlFor={`${uid}-comp-reason`} required>
                                <Input id={`${uid}-comp-reason`} value={compensationForm.reason} onChange={(event) => setCompensationForm(current => ({ ...current, reason: event.target.value }))} required minLength={3} maxLength={500} />
                            </Field>
                            <div className={styles.actionsEnd}>
                                <Button variant="primary" icon={Plus} type="submit" loading={saving}>Guardar nueva versión</Button>
                            </div>
                        </FormSection>
                    </form>
                    <RecordList title="Historial de compensación" empty="Sin historial de compensación.">{compensations.map(item => (
                        <li key={item.id}>
                            <span className={styles.cellStack}>
                                <span className={`${styles.cellTitle} hr-money`}>{formatHrMoney(item.currency, item.amount)} · {item.compensationType === 'SALARY' ? 'Salario' : 'Tarifa por hora'}</span>
                                <span className={styles.cellSub}>{frequencyText(item.payFrequency)} · {dateText(item.effectiveFrom)} a {dateText(item.effectiveTo)}</span>
                                <span className={styles.cellSub}>{item.reason} · por {item.changedBy?.name ?? 'usuario registrado'}</span>
                            </span>
                            <Badge tone={item.effectiveTo ? 'neutral' : 'success'}>{item.effectiveTo ? 'HISTÓRICA' : 'VIGENTE'}</Badge>
                        </li>
                    ))}</RecordList>
                </>
            )}

            {mode === 'documents' && (
                <>
                    <div className={`${styles.alertInfo} ${styles.actions}`}><FileLock2 size={16} aria-hidden="true" />Sólo PDF/JPEG/PNG, máximo 10 MB. El servidor valida firma, tamaño y SHA-256; la descarga falla cerrada si cambia el archivo.</div>
                    <form aria-label="Custodiar documento" onSubmit={(event) => {
                        event.preventDefault();
                        if (!documentForm.file) { setError('Seleccione un archivo.'); return; }
                        void mutate(() => hrClient.uploadEmployeeDocument(employeeId, { documentType: documentForm.documentType, expiresAt: documentForm.expiresAt || undefined, file: documentForm.file! }), 'Documento validado y custodiado.');
                    }}>
                        <FormSection title="Custodiar documento">
                            <FormGrid>
                                <Field label="Tipo" htmlFor={`${uid}-doc-type`} required>
                                    <Input id={`${uid}-doc-type`} value={documentForm.documentType} onChange={(event) => setDocumentForm(current => ({ ...current, documentType: event.target.value.toUpperCase() }))} required maxLength={100} />
                                </Field>
                                <Field label="Expira" htmlFor={`${uid}-doc-expires`}>
                                    <DateInput id={`${uid}-doc-expires`} min={today()} value={documentForm.expiresAt} onChange={(event) => setDocumentForm(current => ({ ...current, expiresAt: event.target.value }))} />
                                </Field>
                                <Field label="Archivo" htmlFor={`${uid}-doc-file`} required>
                                    <Input id={`${uid}-doc-file`} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setDocumentForm(current => ({ ...current, file: event.target.files?.[0] ?? null }))} required />
                                </Field>
                            </FormGrid>
                            <div className={styles.actionsEnd}>
                                <Button variant="primary" icon={Plus} type="submit" loading={saving}>Validar y custodiar</Button>
                            </div>
                        </FormSection>
                    </form>
                    <Field label="Razón para revocar documentos" htmlFor={`${uid}-doc-revoke`}>
                        <Input id={`${uid}-doc-revoke`} value={revocationReason} onChange={(event) => setRevocationReason(event.target.value)} maxLength={500} placeholder="Obligatoria al revocar" />
                    </Field>
                    <RecordList title="Documentos custodiados" empty="Sin documentos custodiados.">{documents.map(document => (
                        <li key={document.id}>
                            <span className={styles.cellStack}>
                                <span className={styles.cellTitle}>{document.documentType} · {document.fileName}</span>
                                <span className={styles.cellSub}>{Math.ceil(document.sizeBytes / 1024)} KB · expira {dateText(document.expiresAt)}</span>
                                <span className={styles.cellSub}>SHA-256 {document.contentHash.slice(0, 16)}… · {document.status}</span>
                            </span>
                            <span className={styles.actions}>
                                <Button size="sm" variant="ghost" icon={Download} disabled={saving || document.status !== 'ACTIVE'} onClick={() => void mutate(() => hrClient.downloadEmployeeDocument(employeeId, document), 'Descarga verificada.')}>Descargar</Button>
                                <Button size="sm" variant="danger" disabled={saving || document.status !== 'ACTIVE' || revocationReason.trim().length < 3} onClick={() => void mutate(() => hrClient.revokeEmployeeDocument(employeeId, document.id, revocationReason), 'Documento revocado y purgado.')}>Revocar</Button>
                            </span>
                        </li>
                    ))}</RecordList>
                </>
            )}
        </div>
    );
}

function RecordList({ title, children, empty }: { title: string; children: React.ReactNode; empty: string }) {
    const count = Array.isArray(children) ? children.length : children ? 1 : 0;
    return (
        <FormSection title={title}>
            {count ? <ul className={styles.list}>{children}</ul> : <EmptyState title={empty} />}
        </FormSection>
    );
}
