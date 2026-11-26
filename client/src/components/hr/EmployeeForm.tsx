import { useEffect, useMemo, useState } from 'react';
import type { SingleValue } from './HrOptionSelect';
import { Button, Checkbox, DateInput, Field, FormGrid, FormSection, FullScreenModal, Input, Textarea } from '@/ui';
import Select from './HrOptionSelect';
import HrMoneyInput from './HrMoneyInput';
import styles from './hrForm.module.css';
import type {
    HrEmployee,
    HrEmployeePayload,
    HrNamedEntity,
    HrOrganizationCatalogs,
    HrPayFrequency,
    HrUserSummary,
} from '../../types/hr';

type FormTab = 'data' | 'relationship' | 'compensation' | 'user' | 'assignment';
type Option = { value: string; label: string };

interface EmployeeFormProps {
    isOpen: boolean;
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
    /** ISO weekdays (1 = lunes .. 7 = domingo); empty = legal default (domingo). */
    weeklyRestDays: number[];
    departmentId: string;
    jobPositionId: string;
    costCenterId: string;
    branchIds: string[];
    primaryBranchId: string;
    compensationType: 'SALARY' | 'HOURLY';
    payFrequency: HrPayFrequency;
    compensationAmount: string;
    compensationCurrency: string;
    compensationReason: string;
}

/** ISO weekdays, matching Employee.weeklyRestDays on the server. */
const REST_DAY_OPTIONS = [
    { value: 1, label: 'Lun' }, { value: 2, label: 'Mar' }, { value: 3, label: 'Mié' }, { value: 4, label: 'Jue' },
    { value: 5, label: 'Vie' }, { value: 6, label: 'Sáb' }, { value: 7, label: 'Dom' },
] as const;

/** Weekly rest days allowed per employee (Art. 64 CT séptimo día; at most a two-day rest). */
const MAX_WEEKLY_REST_DAYS = 2;

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
    weeklyRestDays: [],
    departmentId: '',
    jobPositionId: '',
    costCenterId: '',
    branchIds: [],
    primaryBranchId: '',
    compensationType: 'SALARY',
    payFrequency: 'MONTHLY',
    compensationAmount: '',
    compensationCurrency: 'NIO',
    compensationReason: 'Compensación inicial acordada',
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
        weeklyRestDays: employee.weeklyRestDays ?? [],
        departmentId: employee.departmentId ? String(employee.departmentId) : '',
        jobPositionId: employee.jobPositionId ? String(employee.jobPositionId) : '',
        costCenterId: employee.costCenterId ? String(employee.costCenterId) : '',
        branchIds: assignments.map((assignment) => String(assignment.branchId)),
        primaryBranchId: primary ? String(primary.branchId) : '',
        compensationType: 'SALARY',
        payFrequency: 'MONTHLY',
        compensationAmount: '',
        compensationCurrency: 'NIO',
        compensationReason: '',
    };
}

function nullable(value: string): string | null {
    const trimmed = value.trim();
    return trimmed || null;
}

export default function EmployeeForm({
    isOpen,
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
        if (form.weeklyRestDays.length > MAX_WEEKLY_REST_DAYS) {
            setActiveTab('relationship');
            setValidationError('Selecciona uno o dos días de descanso semanal.');
            return;
        }
        if (!form.hireDate) {
            setActiveTab('relationship');
            setValidationError('La fecha de ingreso es obligatoria.');
            return;
        }
        if (!employee && (!/^\d+(?:\.\d{1,2})?$/.test(form.compensationAmount) || Number(form.compensationAmount) <= 0)) {
            setActiveTab('compensation');
            setValidationError('Ingresa una compensación inicial válida mayor que cero.');
            return;
        }
        if (!employee && form.compensationReason.trim().length < 3) {
            setActiveTab('compensation');
            setValidationError('Documenta el motivo de la compensación inicial.');
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
            weeklyRestDays: form.weeklyRestDays.length ? [...form.weeklyRestDays].sort((a, b) => a - b) : null,
            departmentId: form.departmentId ? Number(form.departmentId) : null,
            jobPositionId: form.jobPositionId ? Number(form.jobPositionId) : null,
            costCenterId: form.costCenterId ? Number(form.costCenterId) : null,
            branchIds: form.branchIds.map(Number),
            primaryBranchId: form.primaryBranchId ? Number(form.primaryBranchId) : null,
            ...(!employee ? {
                initialCompensation: {
                    compensationType: form.compensationType,
                    payFrequency: form.payFrequency,
                    amount: form.compensationAmount,
                    currency: form.compensationCurrency,
                    reason: form.compensationReason.trim(),
                },
            } : {}),
        });
    };

    const frequencyOptions: Option[] = [
        { value: 'WEEKLY', label: 'Semanal · 52 períodos/año' },
        { value: 'BIWEEKLY', label: 'Quincenal · 24 períodos/año' },
        { value: 'FORTNIGHTLY', label: 'Catorcenal · 26 períodos/año' },
        { value: 'MONTHLY', label: 'Mensual · 12 períodos/año' },
    ];
    const tabs = [
        { id: 'data', label: 'Datos' },
        { id: 'relationship', label: 'Relación laboral' },
        ...(!employee ? [{ id: 'compensation', label: 'Compensación' }] : []),
        { id: 'user', label: 'Usuario' },
        { id: 'assignment', label: 'Asignación' },
    ];

    return (
        <FullScreenModal
            isOpen={isOpen}
            onClose={onCancel}
            title={employee ? `Editar: ${employee.legalName}` : 'Nuevo empleado'}
            breadcrumb={['Recursos humanos', 'Personal']}
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as FormTab)}
            footer={({ requestClose }) => (
                <>
                    <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
                    <Button variant="primary" type="submit" form="hr-employee-form" loading={saving}>{employee ? 'Guardar cambios' : 'Crear empleado'}</Button>
                </>
            )}
        >
            <form id="hr-employee-form" className={styles.form} onSubmit={submit} aria-label="Expediente del empleado">
                {validationError && <div className={styles.alertDanger} role="alert">{validationError}</div>}

                {activeTab === 'data' && (
                    <div id="hr-employee-panel-data" role="tabpanel" aria-label="Datos" className={styles.form}>
                        <FormSection title="Identificación y contacto">
                            <FormGrid>
                                <Field label="Código de empleado" htmlFor="hr-employee-code" required>
                                    <Input id="hr-employee-code" value={form.employeeCode} onChange={(event) => update('employeeCode', event.target.value)} required />
                                </Field>
                                <Field label="Identificación" htmlFor="hr-employee-document">
                                    <Input id="hr-employee-document" value={form.documentNumber} onChange={(event) => update('documentNumber', event.target.value)} />
                                </Field>
                                <Field label="Nombre legal" htmlFor="hr-employee-name" required>
                                    <Input id="hr-employee-name" value={form.legalName} onChange={(event) => update('legalName', event.target.value)} required />
                                </Field>
                                <Field label="Nombre preferido" htmlFor="hr-employee-preferred-name">
                                    <Input id="hr-employee-preferred-name" value={form.preferredName} onChange={(event) => update('preferredName', event.target.value)} />
                                </Field>
                                <Field label="Tipo de identificación" htmlFor="hr-employee-document-type">
                                    <Input id="hr-employee-document-type" value={form.documentType} onChange={(event) => update('documentType', event.target.value)} placeholder="Cédula, residencia, pasaporte" />
                                </Field>
                                <Field label="RUC / identificación tributaria" htmlFor="hr-employee-tax-id">
                                    <Input id="hr-employee-tax-id" value={form.taxId} onChange={(event) => update('taxId', event.target.value)} />
                                </Field>
                                <Field label="Número de asegurado INSS" htmlFor="hr-employee-inss" hint="Obligatorio para calcular una corrida cuya regla INSS esté marcada como aplicable.">
                                    <Input id="hr-employee-inss" value={form.socialSecurityNumber} onChange={(event) => update('socialSecurityNumber', event.target.value)} />
                                </Field>
                                <Field label="Correo laboral" htmlFor="hr-employee-email">
                                    <Input id="hr-employee-email" type="email" value={form.workEmail} onChange={(event) => update('workEmail', event.target.value)} />
                                </Field>
                                <Field label="Teléfono laboral" htmlFor="hr-employee-phone">
                                    <Input id="hr-employee-phone" value={form.workPhone} onChange={(event) => update('workPhone', event.target.value)} />
                                </Field>
                            </FormGrid>
                            <Field label="Dirección" htmlFor="hr-employee-address">
                                <Textarea id="hr-employee-address" rows={3} value={form.address} onChange={(event) => update('address', event.target.value)} />
                            </Field>
                        </FormSection>
                        <FormSection title="Contacto de emergencia">
                            <FormGrid>
                                <Field label="Nombre" htmlFor="hr-employee-emergency-name">
                                    <Input id="hr-employee-emergency-name" value={form.emergencyContactName} onChange={(event) => update('emergencyContactName', event.target.value)} />
                                </Field>
                                <Field label="Teléfono" htmlFor="hr-employee-emergency-phone">
                                    <Input id="hr-employee-emergency-phone" value={form.emergencyContactPhone} onChange={(event) => update('emergencyContactPhone', event.target.value)} />
                                </Field>
                                <Field label="Parentesco o relación" htmlFor="hr-employee-emergency-relation">
                                    <Input id="hr-employee-emergency-relation" value={form.emergencyContactRelationship} onChange={(event) => update('emergencyContactRelationship', event.target.value)} />
                                </Field>
                            </FormGrid>
                            <Field label="Notas internas" htmlFor="hr-employee-notes">
                                <Textarea id="hr-employee-notes" rows={3} value={form.notes} onChange={(event) => update('notes', event.target.value)} />
                            </Field>
                        </FormSection>
                    </div>
                )}

                {activeTab === 'relationship' && (
                    <div id="hr-employee-panel-relationship" role="tabpanel" aria-label="Relación laboral">
                        <FormSection title="Relación laboral">
                            <FormGrid>
                                <Field label="Fecha de ingreso" htmlFor="hr-employee-hire-date" required>
                                    <DateInput id="hr-employee-hire-date" value={form.hireDate} onChange={(event) => update('hireDate', event.target.value)} required />
                                </Field>
                                <Field label="Tipo de empleo" htmlFor="hr-employee-type">
                                    <Select<Option>
                                        inputId="hr-employee-type"
                                        options={(lookups.enums?.employmentTypes ?? []).map((value) => ({ value, label: value.replace(/_/g, ' ') }))}
                                        value={form.employmentType ? { value: form.employmentType, label: form.employmentType.replace(/_/g, ' ') } : null}
                                        onChange={(option: SingleValue<Option>) => update('employmentType', option?.value ?? '')}
                                        placeholder="Seleccionar"
                                        isClearable
                                    />
                                </Field>
                                <Select<Option>
                                    label="Departamento"
                                    options={lookups.departments.map((item) => ({ value: String(item.id), label: item.name }))}
                                    value={asOption(lookups.departments.find((item) => String(item.id) === form.departmentId))}
                                    onChange={(option: SingleValue<Option>) => setForm((current) => ({ ...current, departmentId: option?.value ?? '', jobPositionId: '' }))}
                                    isClearable
                                />
                                <Select<Option>
                                    label="Puesto"
                                    options={positionOptions}
                                    value={positionOptions.find((option) => option.value === form.jobPositionId) ?? null}
                                    onChange={(option: SingleValue<Option>) => update('jobPositionId', option?.value ?? '')}
                                    isClearable
                                />
                                <Select<Option>
                                    label="Centro de costo"
                                    options={lookups.costCenters.map((item) => ({ value: String(item.id), label: item.name }))}
                                    value={asOption(lookups.costCenters.find((item) => String(item.id) === form.costCenterId))}
                                    onChange={(option: SingleValue<Option>) => update('costCenterId', option?.value ?? '')}
                                    isClearable
                                />
                            </FormGrid>
                            <fieldset className={styles.fieldset}>
                                <legend id="hr-employee-rest-days-label">Día(s) de descanso semanal</legend>
                                <div className={styles.checkRow} role="group" aria-labelledby="hr-employee-rest-days-label">
                                    {REST_DAY_OPTIONS.map((day) => {
                                        const checked = form.weeklyRestDays.includes(day.value);
                                        const blocked = !checked && form.weeklyRestDays.length >= MAX_WEEKLY_REST_DAYS;
                                        return (
                                            <Checkbox
                                                key={day.value}
                                                label={day.label}
                                                checked={checked}
                                                disabled={blocked}
                                                onChange={() => update('weeklyRestDays', checked
                                                    ? form.weeklyRestDays.filter((value) => value !== day.value)
                                                    : [...form.weeklyRestDays, day.value])}
                                            />
                                        );
                                    })}
                                </div>
                                <p className={styles.help}>
                                    Séptimo día (Art. 64 CT). Las horas trabajadas en el descanso se pagan con el recargo configurado en la regla de nómina (doble por defecto). Máximo dos días.
                                    {form.weeklyRestDays.length === 0 ? ' Sin selección se aplica el domingo y la nómina lo marca para revisión.' : ''}
                                </p>
                            </fieldset>
                        </FormSection>
                    </div>
                )}

                {activeTab === 'compensation' && !employee && (
                    <div id="hr-employee-panel-compensation" role="tabpanel" aria-label="Compensación">
                        <FormSection title="Compensación inicial" description="Se registrará junto con el expediente en una sola operación. Los cambios posteriores crearán una nueva versión en el historial salarial.">
                            <FormGrid>
                                <Select<Option>
                                    label="Tipo de compensación"
                                    options={[
                                        { value: 'SALARY', label: 'Salario por período' },
                                        { value: 'HOURLY', label: 'Tarifa por hora' },
                                    ]}
                                    value={{ value: form.compensationType, label: form.compensationType === 'SALARY' ? 'Salario por período' : 'Tarifa por hora' }}
                                    onChange={(option: SingleValue<Option>) => update('compensationType', (option?.value ?? 'SALARY') as FormState['compensationType'])}
                                />
                                <Select<Option>
                                    label="Frecuencia de pago"
                                    options={frequencyOptions}
                                    value={frequencyOptions.find((option) => option.value === form.payFrequency)}
                                    onChange={(option: SingleValue<Option>) => update('payFrequency', (option?.value ?? 'MONTHLY') as HrPayFrequency)}
                                />
                                <Field label={form.compensationType === 'HOURLY' ? 'Tarifa por hora' : 'Monto por período'} htmlFor="hr-employee-compensation-amount" hint="Se muestra con separadores y se envía como decimal canónico." required>
                                    <HrMoneyInput id="hr-employee-compensation-amount" value={form.compensationAmount} onValueChange={(value) => update('compensationAmount', value)} required />
                                </Field>
                                <Select<Option>
                                    label="Moneda"
                                    options={[{ value: 'NIO', label: 'NIO · Córdoba' }, { value: 'USD', label: 'USD · Dólar' }]}
                                    value={form.compensationCurrency === 'USD' ? { value: 'USD', label: 'USD · Dólar' } : { value: 'NIO', label: 'NIO · Córdoba' }}
                                    onChange={(option: SingleValue<Option>) => update('compensationCurrency', option?.value ?? 'NIO')}
                                />
                            </FormGrid>
                            <Field label="Motivo y respaldo" htmlFor="hr-employee-compensation-reason" required>
                                <Textarea id="hr-employee-compensation-reason" rows={3} maxLength={500} value={form.compensationReason} onChange={(event) => update('compensationReason', event.target.value)} required />
                            </Field>
                        </FormSection>
                    </div>
                )}

                {activeTab === 'user' && (
                    <div id="hr-employee-panel-user" role="tabpanel" aria-label="Usuario">
                        <FormSection title="Usuario vinculado" description="Al crear el expediente, el usuario se convierte en interno de forma atómica. Un usuario ya vinculado a otro empleado no aparece como opción.">
                            <Select<Option>
                                label="Usuario del sistema"
                                options={availableUsers.map((user) => ({ value: String(user.id), label: `${user.name} · @${user.username}` }))}
                                value={selectedUser ? { value: String(selectedUser.id), label: `${selectedUser.name} · @${selectedUser.username}` } : null}
                                onChange={(option: SingleValue<Option>) => update('userId', option?.value ?? '')}
                                isDisabled={Boolean(employee)}
                                placeholder="Seleccionar usuario externo"
                            />
                            {selectedUser && (
                                <dl className={styles.facts}>
                                    <div><dt>Cuenta</dt><dd>@{selectedUser.username}</dd></div>
                                    <div><dt>Tipo actual</dt><dd>{selectedUser.accountType ?? 'EXTERNAL'}</dd></div>
                                    <div><dt>Estado</dt><dd>{selectedUser.status ?? '—'}</dd></div>
                                </dl>
                            )}
                        </FormSection>
                    </div>
                )}

                {activeTab === 'assignment' && (
                    <div id="hr-employee-panel-assignment" role="tabpanel" aria-label="Asignación">
                        <FormSection title="Adscripción laboral" description="La adscripción laboral es independiente de las sucursales operativas permitidas al usuario.">
                            <div className={styles.checkGrid} role="group" aria-label="Sucursales laborales">
                                {assignableBranches.map((branch) => {
                                    const id = String(branch.id);
                                    return (
                                        <Checkbox key={branch.id} label={branch.name} checked={form.branchIds.includes(id)} onChange={() => toggleBranch(id)} />
                                    );
                                })}
                            </div>
                            {form.branchIds.length > 0 && (
                                <Select<Option>
                                    label="Sucursal principal"
                                    options={assignableBranches.filter((branch) => form.branchIds.includes(String(branch.id))).map((branch) => ({ value: String(branch.id), label: branch.name }))}
                                    value={asOption(assignableBranches.find((branch) => String(branch.id) === form.primaryBranchId))}
                                    onChange={(option: SingleValue<Option>) => update('primaryBranchId', option?.value ?? '')}
                                />
                            )}
                            {(lookups.branches ?? []).length === 0 && (
                                <div className={styles.alertWarning} role="status">No hay sucursales disponibles en el catálogo.</div>
                            )}
                        </FormSection>
                    </div>
                )}
            </form>
        </FullScreenModal>
    );
}
