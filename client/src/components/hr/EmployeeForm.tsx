import { useEffect, useMemo, useState } from 'react';
import type { SingleValue } from 'react-select';
import {
    Building2,
    Briefcase,
    FileText,
    MapPin,
    UserRound,
} from 'lucide-react';
import Button from '../Button';
import Select from '../Select';
import type {
    HrEmployee,
    HrEmployeePayload,
    HrNamedEntity,
    HrOrganizationCatalogs,
    HrUserSummary,
} from '../../types/hr';

type FormTab = 'data' | 'relationship' | 'user' | 'assignment';
type Option = { value: string; label: string };

interface EmployeeFormProps {
    employee: HrEmployee | null;
    lookups: HrOrganizationCatalogs;
    users: HrUserSummary[];
    saving: boolean;
    onCancel: () => void;
    onSubmit: (payload: HrEmployeePayload) => Promise<void>;
}

interface FormState {
    userId: string;
    employeeCode: string;
    legalName: string;
    preferredName: string;
    documentType: string;
    documentNumber: string;
    socialSecurityNumber: string;
    taxId: string;
    workEmail: string;
    workPhone: string;
    address: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    emergencyContactRelationship: string;
    notes: string;
    hireDate: string;
    employmentType: string;
    departmentId: string;
    jobPositionId: string;
    costCenterId: string;
    branchIds: string[];
    primaryBranchId: string;
}

const EMPTY_FORM: FormState = {
    userId: '',
    employeeCode: '',
    legalName: '',
    preferredName: '',
    documentType: '',
    documentNumber: '',
    socialSecurityNumber: '',
    taxId: '',
    workEmail: '',
    workPhone: '',
    address: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
    notes: '',
    hireDate: '',
    employmentType: '',
    departmentId: '',
    jobPositionId: '',
    costCenterId: '',
    branchIds: [],
    primaryBranchId: '',
};

const asOption = (entity?: HrNamedEntity | null): Option | null =>
    entity ? { value: String(entity.id), label: entity.name } : null;

function initialState(employee: HrEmployee | null): FormState {
    if (!employee) return EMPTY_FORM;
    const assignments = (employee.branchAssignments ?? []).filter((assignment) => !assignment.effectiveTo && !assignment.activeTo);
    const primary = assignments.find((assignment) => assignment.isPrimary);
    return {
        userId: String(employee.userId),
        employeeCode: employee.employeeCode ?? '',
        legalName: employee.legalName ?? '',
        preferredName: employee.preferredName ?? '',
        documentType: employee.documentType ?? '',
        documentNumber: employee.documentNumber ?? '',
        socialSecurityNumber: employee.socialSecurityNumber ?? '',
        taxId: employee.taxId ?? '',
        workEmail: employee.workEmail ?? '',
        workPhone: employee.workPhone ?? '',
        address: employee.address ?? '',
        emergencyContactName: employee.emergencyContactName ?? '',
        emergencyContactPhone: employee.emergencyContactPhone ?? '',
        emergencyContactRelationship: employee.emergencyContactRelationship ?? '',
        notes: employee.notes ?? '',
        hireDate: employee.hireDate?.slice(0, 10) ?? '',
        employmentType: employee.employmentType ?? '',
        departmentId: employee.departmentId ? String(employee.departmentId) : '',
        jobPositionId: employee.jobPositionId ? String(employee.jobPositionId) : '',
        costCenterId: employee.costCenterId ? String(employee.costCenterId) : '',
        branchIds: assignments.map((assignment) => String(assignment.branchId)),
        primaryBranchId: primary ? String(primary.branchId) : '',
    };
}

function nullable(value: string): string | null {
    const trimmed = value.trim();
    return trimmed || null;
}

export default function EmployeeForm({
    employee,
    lookups,
    users,
    saving,
    onCancel,
    onSubmit,
}: EmployeeFormProps) {
    const [activeTab, setActiveTab] = useState<FormTab>('data');
    const [form, setForm] = useState<FormState>(() => initialState(employee));
    const [validationError, setValidationError] = useState<string | null>(null);

    useEffect(() => {
        setForm(initialState(employee));
        setActiveTab('data');
        setValidationError(null);
    }, [employee]);

    const availableUsers = useMemo(() => users.filter((candidate) =>
        candidate.id === employee?.userId || !candidate.employee
    ), [employee?.userId, users]);

    const positionOptions = useMemo(() => lookups.positions
        .filter((position) => !form.departmentId || String(position.departmentId ?? '') === form.departmentId)
        .map((position) => ({ value: String(position.id), label: position.name })),
    [form.departmentId, lookups.positions]);

    const selectedUser = users.find((user) => String(user.id) === form.userId) ?? null;
    const assignableBranches = (lookups.branches ?? []).filter((branch) =>
        branch.status === 'ACTIVE' || form.branchIds.includes(String(branch.id))
    );

    const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((current) => ({ ...current, [key]: value }));
        setValidationError(null);
    };

    const toggleBranch = (branchId: string) => {
        setForm((current) => {
            const selected = current.branchIds.includes(branchId)
                ? current.branchIds.filter((id) => id !== branchId)
                : [...current.branchIds, branchId];
            return {
                ...current,
                branchIds: selected,
                primaryBranchId: selected.includes(current.primaryBranchId)
                    ? current.primaryBranchId
                    : (selected[0] ?? ''),
            };
        });
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.employeeCode.trim() || !form.legalName.trim()) {
            setActiveTab('data');
            setValidationError('El código y el nombre legal son obligatorios.');
            return;
        }
        if (!form.hireDate) {
            setActiveTab('relationship');
            setValidationError('La fecha de ingreso es obligatoria.');
            return;
        }
        if (!form.userId) {
            setActiveTab('user');
            setValidationError('Selecciona el usuario que quedará vinculado al empleado.');
            return;
        }
        if (form.branchIds.length > 0 && !form.primaryBranchId) {
            setActiveTab('assignment');
            setValidationError('Selecciona una sucursal principal.');
            return;
        }

        await onSubmit({
            ...(!employee ? { userId: Number(form.userId) } : {}),
            employeeCode: form.employeeCode.trim(),
            legalName: form.legalName.trim(),
            preferredName: nullable(form.preferredName),
            documentType: nullable(form.documentType),
            documentNumber: nullable(form.documentNumber),
            socialSecurityNumber: nullable(form.socialSecurityNumber),
            taxId: nullable(form.taxId),
            workEmail: nullable(form.workEmail),
            workPhone: nullable(form.workPhone),
            address: nullable(form.address),
            emergencyContactName: nullable(form.emergencyContactName),
            emergencyContactPhone: nullable(form.emergencyContactPhone),
            emergencyContactRelationship: nullable(form.emergencyContactRelationship),
            notes: nullable(form.notes),
            hireDate: form.hireDate,
            employmentType: nullable(form.employmentType),
            departmentId: form.departmentId ? Number(form.departmentId) : null,
            jobPositionId: form.jobPositionId ? Number(form.jobPositionId) : null,
            costCenterId: form.costCenterId ? Number(form.costCenterId) : null,
            branchIds: form.branchIds.map(Number),
            primaryBranchId: form.primaryBranchId ? Number(form.primaryBranchId) : null,
        });
    };

    const tab = (id: FormTab, label: string, icon: React.ReactNode) => (
        <button
            type="button"
            id={`hr-employee-tab-${id}`}
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`hr-employee-panel-${id}`}
            className={`modal-tab ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
        >
            {icon}
            <span>{label}</span>
        </button>
    );

    return (
        <div className="premium-modal-content hr-employee-modal-content">
            <div className="modal-tabs" role="tablist" aria-label="Secciones del expediente">
                {tab('data', 'Datos', <UserRound size={18} aria-hidden="true" />)}
                {tab('relationship', 'Relación laboral', <Briefcase size={18} aria-hidden="true" />)}
                {tab('user', 'Usuario', <FileText size={18} aria-hidden="true" />)}
                {tab('assignment', 'Asignación', <MapPin size={18} aria-hidden="true" />)}
            </div>

            <form className="modal-form-new" onSubmit={submit}>
                <div className="modal-tab-content">
                    {validationError && (
                        <div className="hr-inline-alert danger" role="alert">{validationError}</div>
                    )}

                    {activeTab === 'data' && (
                        <section
                            id="hr-employee-panel-data"
                            role="tabpanel"
                            aria-labelledby="hr-employee-tab-data"
                            className="modal-content-group"
                        >
                            <div className="modal-section-header">
                                <UserRound size={18} aria-hidden="true" />
                                <h3>Identificación y contacto</h3>
                            </div>
                            <div className="modal-form-row">
                                <div className="modal-input-group">
                                    <label htmlFor="hr-employee-code">Código de empleado</label>
                                    <input id="hr-employee-code" className="modal-standard-input" value={form.employeeCode} onChange={(event) => update('employeeCode', event.target.value)} required />
                                </div>
                                <div className="modal-input-group">
                                    <label htmlFor="hr-employee-document">Identificación</label>
                                    <input id="hr-employee-document" className="modal-standard-input" value={form.documentNumber} onChange={(event) => update('documentNumber', event.target.value)} />
                                </div>
                            </div>
                            <div className="modal-input-group">
                                <label htmlFor="hr-employee-name">Nombre legal</label>
                                <input id="hr-employee-name" className="modal-standard-input" value={form.legalName} onChange={(event) => update('legalName', event.target.value)} required />
                            </div>
                            <div className="modal-input-group">
                                <label htmlFor="hr-employee-preferred-name">Nombre preferido</label>
                                <input id="hr-employee-preferred-name" className="modal-standard-input" value={form.preferredName} onChange={(event) => update('preferredName', event.target.value)} />
                            </div>
                            <div className="modal-form-row">
                                <div className="modal-input-group">
                                    <label htmlFor="hr-employee-document-type">Tipo de identificación</label>
                                    <input id="hr-employee-document-type" className="modal-standard-input" value={form.documentType} onChange={(event) => update('documentType', event.target.value)} placeholder="Cédula, residencia, pasaporte" />
                                </div>
                                <div className="modal-input-group">
                                    <label htmlFor="hr-employee-tax-id">RUC / identificación tributaria</label>
                                    <input id="hr-employee-tax-id" className="modal-standard-input" value={form.taxId} onChange={(event) => update('taxId', event.target.value)} />
                                </div>
                            </div>
                            <div className="modal-input-group">
                                <label htmlFor="hr-employee-inss">Número de asegurado INSS</label>
                                <input id="hr-employee-inss" className="modal-standard-input" value={form.socialSecurityNumber} onChange={(event) => update('socialSecurityNumber', event.target.value)} />
                                <small>Obligatorio para calcular una corrida cuya regla INSS esté marcada como aplicable.</small>
                            </div>
                            <div className="modal-form-row">
                                <div className="modal-input-group">
                                    <label htmlFor="hr-employee-email">Correo laboral</label>
                                    <input id="hr-employee-email" type="email" className="modal-standard-input" value={form.workEmail} onChange={(event) => update('workEmail', event.target.value)} />
                                </div>
                                <div className="modal-input-group">
                                    <label htmlFor="hr-employee-phone">Teléfono laboral</label>
                                    <input id="hr-employee-phone" className="modal-standard-input" value={form.workPhone} onChange={(event) => update('workPhone', event.target.value)} />
                                </div>
                            </div>
                            <div className="modal-input-group">
                                <label htmlFor="hr-employee-address">Dirección</label>
                                <textarea id="hr-employee-address" className="modal-textarea" rows={3} value={form.address} onChange={(event) => update('address', event.target.value)} />
                            </div>
                            <div className="modal-section-header"><UserRound size={18} aria-hidden="true" /><h3>Contacto de emergencia</h3></div>
                            <div className="modal-form-row">
                                <div className="modal-input-group"><label htmlFor="hr-employee-emergency-name">Nombre</label><input id="hr-employee-emergency-name" className="modal-standard-input" value={form.emergencyContactName} onChange={(event) => update('emergencyContactName', event.target.value)} /></div>
                                <div className="modal-input-group"><label htmlFor="hr-employee-emergency-phone">Teléfono</label><input id="hr-employee-emergency-phone" className="modal-standard-input" value={form.emergencyContactPhone} onChange={(event) => update('emergencyContactPhone', event.target.value)} /></div>
                            </div>
                            <div className="modal-input-group"><label htmlFor="hr-employee-emergency-relation">Parentesco o relación</label><input id="hr-employee-emergency-relation" className="modal-standard-input" value={form.emergencyContactRelationship} onChange={(event) => update('emergencyContactRelationship', event.target.value)} /></div>
                            <div className="modal-input-group">
                                <label htmlFor="hr-employee-notes">Notas internas</label>
                                <textarea id="hr-employee-notes" className="modal-textarea" rows={3} value={form.notes} onChange={(event) => update('notes', event.target.value)} />
                            </div>
                        </section>
                    )}

                    {activeTab === 'relationship' && (
                        <section
                            id="hr-employee-panel-relationship"
                            role="tabpanel"
                            aria-labelledby="hr-employee-tab-relationship"
                            className="modal-content-group"
                        >
                            <div className="modal-section-header">
                                <Briefcase size={18} aria-hidden="true" />
                                <h3>Relación laboral</h3>
                            </div>
                            <div className="modal-form-row">
                                <div className="modal-input-group">
                                    <label htmlFor="hr-employee-hire-date">Fecha de ingreso</label>
                                    <input id="hr-employee-hire-date" type="date" className="modal-standard-input" value={form.hireDate} onChange={(event) => update('hireDate', event.target.value)} required />
                                </div>
                                <div className="modal-input-group">
                                    <label htmlFor="hr-employee-type">Tipo de empleo</label>
                                    <Select<Option>
                                        inputId="hr-employee-type"
                                        variant="modal"
                                        options={(lookups.enums?.employmentTypes ?? []).map((value) => ({ value, label: value.replace(/_/g, ' ') }))}
                                        value={form.employmentType ? { value: form.employmentType, label: form.employmentType.replace(/_/g, ' ') } : null}
                                        onChange={(option: SingleValue<Option>) => update('employmentType', option?.value ?? '')}
                                        placeholder="Seleccionar"
                                        isClearable
                                    />
                                </div>
                            </div>
                            <Select<Option>
                                variant="modal"
                                label="Departamento"
                                options={lookups.departments.map((item) => ({ value: String(item.id), label: item.name }))}
                                value={asOption(lookups.departments.find((item) => String(item.id) === form.departmentId))}
                                onChange={(option: SingleValue<Option>) => setForm((current) => ({ ...current, departmentId: option?.value ?? '', jobPositionId: '' }))}
                                isClearable
                            />
                            <Select<Option>
                                variant="modal"
                                label="Puesto"
                                options={positionOptions}
                                value={positionOptions.find((option) => option.value === form.jobPositionId) ?? null}
                                onChange={(option: SingleValue<Option>) => update('jobPositionId', option?.value ?? '')}
                                isClearable
                            />
                            <Select<Option>
                                variant="modal"
                                label="Centro de costo"
                                options={lookups.costCenters.map((item) => ({ value: String(item.id), label: item.name }))}
                                value={asOption(lookups.costCenters.find((item) => String(item.id) === form.costCenterId))}
                                onChange={(option: SingleValue<Option>) => update('costCenterId', option?.value ?? '')}
                                isClearable
                            />
                        </section>
                    )}

                    {activeTab === 'user' && (
                        <section
                            id="hr-employee-panel-user"
                            role="tabpanel"
                            aria-labelledby="hr-employee-tab-user"
                            className="modal-content-group"
                        >
                            <div className="modal-section-header">
                                <FileText size={18} aria-hidden="true" />
                                <h3>Usuario vinculado</h3>
                            </div>
                            <div className="hr-inline-alert info">
                                Al crear el expediente, el usuario se convierte en interno de forma atómica. Un usuario ya vinculado a otro empleado no aparece como opción.
                            </div>
                            <Select<Option>
                                variant="modal"
                                label="Usuario del sistema"
                                options={availableUsers.map((user) => ({ value: String(user.id), label: `${user.name} · @${user.username}` }))}
                                value={selectedUser ? { value: String(selectedUser.id), label: `${selectedUser.name} · @${selectedUser.username}` } : null}
                                onChange={(option: SingleValue<Option>) => update('userId', option?.value ?? '')}
                                isDisabled={Boolean(employee)}
                                placeholder="Seleccionar usuario externo"
                                isSearchable
                            />
                            {selectedUser && (
                                <dl className="hr-summary-list">
                                    <div><dt>Cuenta</dt><dd>@{selectedUser.username}</dd></div>
                                    <div><dt>Tipo actual</dt><dd>{selectedUser.accountType ?? 'EXTERNAL'}</dd></div>
                                    <div><dt>Estado</dt><dd>{selectedUser.status ?? '—'}</dd></div>
                                </dl>
                            )}
                        </section>
                    )}

                    {activeTab === 'assignment' && (
                        <section
                            id="hr-employee-panel-assignment"
                            role="tabpanel"
                            aria-labelledby="hr-employee-tab-assignment"
                            className="modal-content-group"
                        >
                            <div className="modal-section-header">
                                <Building2 size={18} aria-hidden="true" />
                                <h3>Adscripción laboral</h3>
                            </div>
                            <p className="hr-form-help">La adscripción laboral es independiente de las sucursales operativas permitidas al usuario.</p>
                            <div className="hr-branch-picker" role="group" aria-label="Sucursales laborales">
                                {assignableBranches.map((branch) => {
                                    const id = String(branch.id);
                                    const checked = form.branchIds.includes(id);
                                    return (
                                        <label key={branch.id} className={`hr-branch-option ${checked ? 'selected' : ''}`}>
                                            <input type="checkbox" checked={checked} onChange={() => toggleBranch(id)} />
                                            <span>{branch.name}</span>
                                        </label>
                                    );
                                })}
                            </div>
                            {form.branchIds.length > 0 && (
                                <Select<Option>
                                    variant="modal"
                                    label="Sucursal principal"
                                    options={assignableBranches.filter((branch) => form.branchIds.includes(String(branch.id))).map((branch) => ({ value: String(branch.id), label: branch.name }))}
                                    value={asOption(assignableBranches.find((branch) => String(branch.id) === form.primaryBranchId))}
                                    onChange={(option: SingleValue<Option>) => update('primaryBranchId', option?.value ?? '')}
                                    isSearchable={false}
                                />
                            )}
                            {(lookups.branches ?? []).length === 0 && (
                                <div className="hr-inline-alert warning">No hay sucursales disponibles en el catálogo.</div>
                            )}
                        </section>
                    )}
                </div>

                <div className="modal-footer">
                    <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
                    <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : employee ? 'Guardar cambios' : 'Crear empleado'}</Button>
                </div>
            </form>
        </div>
    );
}
