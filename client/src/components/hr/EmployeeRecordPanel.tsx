import HrReactSelect from './HrReactSelect';
import HrMoneyInput from './HrMoneyInput';
import { formatHrMoney } from '../../utils/hrFormat';
import { useCallback, useEffect, useState } from 'react';
import { Download, FileLock2, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
import Button from '../Button';
import LoadingSpinner from '../LoadingSpinner';
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

    if (loading) return <LoadingSpinner text="Cargando historial…" />;

    return (
        <div className="hr-record-panel">
            {error && <div className="hr-record-alert danger" role="alert"><ShieldAlert size={18} />{error}<Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw size={14} /> Recargar</Button></div>}
            {message && <div className="hr-record-alert success" role="status">{message}</div>}

            {mode === 'contracts' && (
                <>
                    <form className="hr-record-form" onSubmit={(event) => {
                        event.preventDefault();
                        void mutate(() => hrClient.createEmployeeContract(employeeId, {
                            ...contractForm, endDate: contractForm.endDate || undefined, notes: contractForm.notes || undefined,
                        }), 'Borrador contractual creado; debe activarse con fecha de firma y razón.');
                    }}>
                        <h3><Plus size={17} /> Nuevo contrato</h3>
                        <label>Número<input value={contractForm.contractNumber} onChange={(event) => setContractForm(current => ({ ...current, contractNumber: event.target.value.toUpperCase() }))} required maxLength={80} /></label>
                        <label>Tipo<HrReactSelect value={contractForm.employmentType} onChange={(event) => setContractForm(current => ({ ...current, employmentType: event.target.value }))}><option value="FULL_TIME">Tiempo completo</option><option value="PART_TIME">Tiempo parcial</option><option value="TEMPORARY">Temporal</option><option value="CONTRACTOR">Contratista</option><option value="INTERN">Pasantía</option></HrReactSelect></label>
                        <label>Inicio<input type="date" value={contractForm.startDate} onChange={(event) => setContractForm(current => ({ ...current, startDate: event.target.value }))} required /></label>
                        <label>Fin previsto<input type="date" min={contractForm.startDate} value={contractForm.endDate} onChange={(event) => setContractForm(current => ({ ...current, endDate: event.target.value }))} /></label>
                        <label className="span-full">Notas<textarea value={contractForm.notes} onChange={(event) => setContractForm(current => ({ ...current, notes: event.target.value }))} maxLength={5000} /></label>
                        <Button type="submit" disabled={saving}>Crear borrador</Button>
                    </form>

                    {contracts.length > 0 && <form className="hr-record-form" onSubmit={(event) => {
                        event.preventDefault();
                        const contractId = Number(transitionForm.contractId);
                        void mutate(() => hrClient.transitionEmployeeContract(employeeId, contractId, {
                            action: transitionForm.action, reason: transitionForm.reason,
                            signedAt: transitionForm.action === 'ACTIVATE' ? new Date(transitionForm.signedAt).toISOString() : undefined,
                            endDate: transitionForm.action === 'ACTIVATE' ? undefined : transitionForm.endDate,
                        }), 'Transición contractual aplicada y auditada.');
                    }}>
                        <h3>Transición controlada</h3>
                        <label>Contrato<HrReactSelect value={transitionForm.contractId} onChange={(event) => setTransitionForm(current => ({ ...current, contractId: event.target.value }))} required><option value="">Seleccione</option>{contracts.map(contract => <option key={contract.id} value={contract.id}>{contract.contractNumber} · {contract.status}</option>)}</HrReactSelect></label>
                        <label>Acción<HrReactSelect value={transitionForm.action} onChange={(event) => setTransitionForm(current => ({ ...current, action: event.target.value as typeof current.action }))}><option value="ACTIVATE">Activar firmado</option><option value="TERMINATE">Terminar</option><option value="EXPIRE">Expirar</option></HrReactSelect></label>
                        {transitionForm.action === 'ACTIVATE' ? <label>Fecha/hora de firma<input type="datetime-local" value={transitionForm.signedAt} onChange={(event) => setTransitionForm(current => ({ ...current, signedAt: event.target.value }))} required /></label> : <label>Fecha final<input type="date" value={transitionForm.endDate} onChange={(event) => setTransitionForm(current => ({ ...current, endDate: event.target.value }))} required /></label>}
                        <label className="span-full">Razón<input value={transitionForm.reason} onChange={(event) => setTransitionForm(current => ({ ...current, reason: event.target.value }))} required minLength={3} maxLength={500} /></label>
                        <Button type="submit" disabled={saving}>Aplicar transición</Button>
                    </form>}

                    <RecordList empty="Sin contratos registrados.">{contracts.map(contract => <article key={contract.id}><div><strong>{contract.contractNumber}</strong><span>{contract.employmentType.replace(/_/g, ' ')} · {dateText(contract.startDate)} a {dateText(contract.endDate)}</span><small>{contract.signedAt ? `Firmado ${contract.signedAt}` : 'Pendiente de firma/activación'}</small></div><b>{contract.status}</b></article>)}</RecordList>
                </>
            )}

            {mode === 'compensation' && (
                <>
                    <form className="hr-record-form" onSubmit={(event) => {
                        event.preventDefault();
                        void mutate(() => hrClient.appendEmployeeCompensation(employeeId, {
                            ...compensationForm, contractId: compensationForm.contractId ? Number(compensationForm.contractId) : undefined,
                        }), 'Nueva versión de compensación creada; la anterior quedó cerrada.');
                    }}>
                        <h3><Plus size={17} /> Versionar compensación</h3>
                        <label>Contrato<HrReactSelect value={compensationForm.contractId} onChange={(event) => setCompensationForm(current => ({ ...current, contractId: event.target.value }))}><option value="">Sin vínculo</option>{contracts.map(contract => <option key={contract.id} value={contract.id}>{contract.contractNumber} · {contract.status}</option>)}</HrReactSelect></label>
                        <label>Tipo<HrReactSelect value={compensationForm.compensationType} onChange={(event) => setCompensationForm(current => ({ ...current, compensationType: event.target.value as typeof current.compensationType }))}><option value="SALARY">Salario</option><option value="HOURLY">Por hora</option></HrReactSelect></label>
                        <label>Frecuencia<HrReactSelect value={compensationForm.payFrequency} onChange={(event) => setCompensationForm(current => ({ ...current, payFrequency: event.target.value as typeof current.payFrequency }))}><option value="WEEKLY">Semanal · 52 períodos/año</option><option value="BIWEEKLY">Quincenal · 24 períodos/año</option><option value="FORTNIGHTLY">Catorcenal · 26 períodos/año</option><option value="MONTHLY">Mensual · 12 períodos/año</option></HrReactSelect></label>
                        <label>Monto<HrMoneyInput value={compensationForm.amount} onValueChange={(amount) => setCompensationForm(current => ({ ...current, amount }))} required /></label>
                        <label>Moneda<HrReactSelect value={compensationForm.currency} onChange={(event) => setCompensationForm(current => ({ ...current, currency: event.target.value }))}><option value="NIO">NIO · Córdoba</option><option value="USD">USD · Dólar</option></HrReactSelect></label>
                        <label>Vigente desde<input type="date" value={compensationForm.effectiveFrom} onChange={(event) => setCompensationForm(current => ({ ...current, effectiveFrom: event.target.value }))} required /></label>
                        <label className="span-full">Razón<input value={compensationForm.reason} onChange={(event) => setCompensationForm(current => ({ ...current, reason: event.target.value }))} required minLength={3} maxLength={500} /></label>
                        <Button type="submit" disabled={saving}>Guardar nueva versión</Button>
                    </form>
                    <RecordList empty="Sin historial de compensación.">{compensations.map(item => <article key={item.id}><div><strong className="hr-money">{formatHrMoney(item.currency, item.amount)} · {item.compensationType === 'SALARY' ? 'Salario' : 'Tarifa por hora'}</strong><span>{frequencyText(item.payFrequency)} · {dateText(item.effectiveFrom)} a {dateText(item.effectiveTo)}</span><small>{item.reason} · por {item.changedBy?.name ?? 'usuario registrado'}</small></div><b>{item.effectiveTo ? 'HISTÓRICA' : 'VIGENTE'}</b></article>)}</RecordList>
                </>
            )}

            {mode === 'documents' && (
                <>
                    <div className="hr-record-alert"><FileLock2 size={18} />Sólo PDF/JPEG/PNG, máximo 10 MB. El servidor valida firma, tamaño y SHA-256; la descarga falla cerrada si cambia el archivo.</div>
                    <form className="hr-record-form" onSubmit={(event) => {
                        event.preventDefault();
                        if (!documentForm.file) { setError('Seleccione un archivo.'); return; }
                        void mutate(() => hrClient.uploadEmployeeDocument(employeeId, { documentType: documentForm.documentType, expiresAt: documentForm.expiresAt || undefined, file: documentForm.file! }), 'Documento validado y custodiado.');
                    }}>
                        <h3><Plus size={17} /> Custodiar documento</h3>
                        <label>Tipo<input value={documentForm.documentType} onChange={(event) => setDocumentForm(current => ({ ...current, documentType: event.target.value.toUpperCase() }))} required maxLength={100} /></label>
                        <label>Expira<input type="date" min={today()} value={documentForm.expiresAt} onChange={(event) => setDocumentForm(current => ({ ...current, expiresAt: event.target.value }))} /></label>
                        <label className="span-full">Archivo<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setDocumentForm(current => ({ ...current, file: event.target.files?.[0] ?? null }))} required /></label>
                        <Button type="submit" disabled={saving}>Validar y custodiar</Button>
                    </form>
                    <label className="hr-record-reason">Razón para revocar documentos<input value={revocationReason} onChange={(event) => setRevocationReason(event.target.value)} maxLength={500} placeholder="Obligatoria al revocar" /></label>
                    <RecordList empty="Sin documentos custodiados.">{documents.map(document => <article key={document.id}><div><strong>{document.documentType} · {document.fileName}</strong><span>{Math.ceil(document.sizeBytes / 1024)} KB · expira {dateText(document.expiresAt)}</span><small>SHA-256 {document.contentHash.slice(0, 16)}… · {document.status}</small></div><div className="hr-record-actions"><Button size="sm" variant="ghost" disabled={saving || document.status !== 'ACTIVE'} onClick={() => void mutate(() => hrClient.downloadEmployeeDocument(employeeId, document), 'Descarga verificada.') }><Download size={14} /> Descargar</Button><Button size="sm" variant="danger" disabled={saving || document.status !== 'ACTIVE' || revocationReason.trim().length < 3} onClick={() => void mutate(() => hrClient.revokeEmployeeDocument(employeeId, document.id, revocationReason), 'Documento revocado y purgado.')}>Revocar</Button></div></article>)}</RecordList>
                </>
            )}
        </div>
    );
}

function RecordList({ children, empty }: { children: React.ReactNode; empty: string }) {
    const count = Array.isArray(children) ? children.length : children ? 1 : 0;
    if (!count) return <div className="hr-panel-empty"><p>{empty}</p></div>;
    return <div className="hr-record-list">{children}</div>;
}
