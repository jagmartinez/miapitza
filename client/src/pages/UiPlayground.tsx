import { useState, type ReactNode } from 'react';
import { Inbox, Plus } from 'lucide-react';
import {
    AppSelect,
    Badge,
    Button,
    Checkbox,
    ConfirmDialog,
    DataTable,
    DateInput,
    Drawer,
    EmptyState,
    Field,
    FormGrid,
    FormSection,
    FullScreenModal,
    IconButton,
    Input,
    NumberInput,
    PageContent,
    PageHeader,
    SegmentedControl,
    Skeleton,
    Spinner,
    StatCard,
    StatusBadge,
    Switch,
    Tabs,
    TableToolbar,
    Textarea,
    formatMoney,
    formatPercent,
    type Column,
    type Opt,
} from '@/ui';

interface Row { id: number; name: string; status: string; qty: number; price: number; margin: number; date: string }

const STATUSES = ['OPEN', 'PAID', 'PENDING', 'CANCELLED'];
const ROWS: Row[] = Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    name: `Producto ${i + 1}`,
    status: STATUSES[i % STATUSES.length],
    qty: (i * 7) % 40,
    price: 12.5 + i * 3.25,
    margin: 20 + (i % 10) * 2.5,
    date: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
}));

const COLUMNS: Column<Row>[] = [
    { key: 'name', header: 'Producto', width: '2fr' },
    { key: 'status', header: 'Estado', width: '1fr', type: 'status', render: (r) => <StatusBadge status={r.status} label={r.status} /> },
    { key: 'qty', header: 'Cantidad', width: '1fr', type: 'qty', total: true },
    { key: 'price', header: 'Precio', width: '1fr', type: 'money', total: true },
    { key: 'margin', header: 'Margen', width: '1fr', type: 'percent' },
    { key: 'date', header: 'Fecha', width: '1fr', type: 'date' },
];

const OPTIONS: Opt<string>[] = [
    { value: 'a', label: 'Cocina', description: 'Área de producción' },
    { value: 'b', label: 'Bodega' },
    { value: 'c', label: 'Salón' },
];

function Block({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-3)' }}>
            <h2 style={{ margin: 0, fontSize: 16, color: 'var(--ui-text)' }}>{title}</h2>
            {children}
        </section>
    );
}

/** Referencia viva de `@/ui`; solo existe en desarrollo (ruta /dev/ui). */
export default function UiPlayground() {
    const [tab, setTab] = useState('general');
    const [modalTab, setModalTab] = useState('datos');
    const [modal, setModal] = useState(false);
    const [drawer, setDrawer] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [single, setSingle] = useState<string | null>('a');
    const [multi, setMulti] = useState<string[]>(['a', 'c']);
    const [asyncVal, setAsyncVal] = useState<Opt<string> | null>(null);
    const [creatable, setCreatable] = useState<string | null>(null);
    const [creatableOpts, setCreatableOpts] = useState<Opt<string>[]>(OPTIONS);
    const [amount, setAmount] = useState<number | null>(1234.5);
    const [on, setOn] = useState(true);
    const [seg, setSeg] = useState('dia');
    const [filter, setFilter] = useState('todos');
    const [dirty, setDirty] = useState(false);

    const rows = filter === 'todos' ? ROWS : ROWS.filter((r) => r.status === filter);

    return (
        <PageContent>
            <PageHeader
                title="Referencia de componentes"
                description="Cada componente de @/ui con sus variantes. Cambia el tema para revisar claro y oscuro."
                breadcrumb={['Desarrollo', 'UI']}
                actions={<Button variant="primary" icon={Plus} onClick={() => setModal(true)}>Abrir formulario</Button>}
            />

            <Block title="Indicadores">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: 'var(--ui-space-4)' }}>
                    <StatCard label="Ventas del día" value={formatMoney(12345.6)} context="+8% frente a ayer" tone="success" action={{ label: 'Ver detalle', to: '/dashboard' }} />
                    <StatCard label="Margen" value={formatPercent(32.5)} context="Meta 30.00 %" tone="primary" />
                    <StatCard label="Insumos bajo mínimo" value="7" context="3 críticos para hoy" tone="warning" action={{ label: 'Revisar', onClick: () => setDrawer(true) }} />
                    <StatCard label="Cuentas vencidas" value={formatMoney(980)} context="2 proveedores" tone="danger" />
                </div>
            </Block>

            <Block title="Botones, insignias y estados">
                <div style={{ display: 'flex', gap: 'var(--ui-space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <Button variant="primary">Primario</Button>
                    <Button>Secundario</Button>
                    <Button variant="ghost">Fantasma</Button>
                    <Button variant="danger">Peligro</Button>
                    <Button variant="primary" loading>Guardando</Button>
                    <Button size="sm">Pequeño</Button>
                    <IconButton icon={Plus} label="Agregar" />
                    <Badge tone="success" dot>Activo</Badge>
                    <Badge tone="warning">Pendiente</Badge>
                    <Badge tone="danger">Error</Badge>
                    <StatusBadge status="PAID" label="Pagada" />
                    <Spinner />
                    <Skeleton width={120} height={14} />
                </div>
            </Block>

            <Block title="Formularios">
                <FormSection title="Datos generales" description="Campos de ejemplo" step={1}>
                    <FormGrid>
                        <Field label="Nombre" htmlFor="pg-name" required hint="Como aparece en el menú"><Input id="pg-name" placeholder="Pizza margarita" /></Field>
                        <Field label="Monto" htmlFor="pg-amount"><NumberInput id="pg-amount" value={amount} onChange={setAmount} prefix="C$" /></Field>
                        <Field label="Fecha" htmlFor="pg-date"><DateInput id="pg-date" /></Field>
                        <Field label="Con error" htmlFor="pg-err" error="Campo obligatorio"><Input id="pg-err" aria-invalid /></Field>
                        <Field label="Notas" htmlFor="pg-notes"><Textarea id="pg-notes" /></Field>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-3)' }}>
                            <Switch label="Activo" checked={on} onChange={setOn} />
                            <Checkbox label="Requiere receta" />
                            <SegmentedControl ariaLabel="Periodo" value={seg} onChange={setSeg} options={[{ value: 'dia', label: 'Día' }, { value: 'sem', label: 'Semana' }, { value: 'mes', label: 'Mes' }]} />
                        </div>
                    </FormGrid>
                </FormSection>
            </Block>

            <Block title="Selectores (AppSelect)">
                <FormGrid>
                    <Field label="Simple" htmlFor="pg-s1"><AppSelect inputId="pg-s1" options={OPTIONS} value={single} onChange={setSingle} /></Field>
                    <Field label="Múltiple" htmlFor="pg-s2"><AppSelect<string> kind="multi" inputId="pg-s2" options={OPTIONS} value={multi} onChange={setMulti} /></Field>
                    <Field label="Búsqueda asíncrona" htmlFor="pg-s3">
                        <AppSelect
                            kind="async"
                            inputId="pg-s3"
                            value={asyncVal}
                            onChange={setAsyncVal}
                            loadOptions={async (q) => OPTIONS.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))}
                        />
                    </Field>
                    <Field label="Creable" htmlFor="pg-s4">
                        <AppSelect
                            kind="creatable"
                            inputId="pg-s4"
                            options={creatableOpts}
                            value={creatable}
                            onChange={setCreatable}
                            onCreate={(label) => {
                                const value = label.toLowerCase();
                                setCreatableOpts((o) => [...o, { value, label }]);
                                setCreatable(value);
                            }}
                        />
                    </Field>
                </FormGrid>
            </Block>

            <Block title="Tabs">
                <Tabs ariaLabel="Ejemplo" active={tab} onChange={setTab} tabs={[{ id: 'general', label: 'General' }, { id: 'costos', label: 'Costos', badge: 3 }, { id: 'bloq', label: 'Bloqueada', disabled: true }]} />
                <p style={{ margin: 0, color: 'var(--ui-text-muted)' }}>Pestaña activa: {tab}</p>
            </Block>

            <Block title="Tabla de datos (60 filas)">
                <DataTable
                    ariaLabel="Productos de ejemplo"
                    columns={COLUMNS}
                    rows={rows}
                    rowKey={(r) => r.id}
                    resetKey={filter}
                    footerLabel="Totales de la página"
                    empty={<EmptyState icon={Inbox} title="Sin productos" description="Prueba otro filtro" />}
                    toolbar={
                        <TableToolbar actions={<Button size="sm">Exportar</Button>}>
                            <SegmentedControl
                                size="sm"
                                ariaLabel="Filtrar por estado"
                                value={filter}
                                onChange={setFilter}
                                options={[{ value: 'todos', label: 'Todos' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
                            />
                        </TableToolbar>
                    }
                />
                <DataTable ariaLabel="Tabla vacía" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} empty={<EmptyState icon={Inbox} title="Sin registros" />} />
                <DataTable ariaLabel="Tabla cargando" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} loading />
            </Block>

            <Block title="Superposiciones">
                <div style={{ display: 'flex', gap: 'var(--ui-space-2)', flexWrap: 'wrap' }}>
                    <Button onClick={() => setModal(true)}>Modal a pantalla completa</Button>
                    <Button onClick={() => setDrawer(true)}>Drawer de filtros</Button>
                    <Button variant="danger" onClick={() => setConfirm(true)}>Confirmar eliminación</Button>
                </div>
            </Block>

            <FullScreenModal
                isOpen={modal}
                onClose={() => { setModal(false); setDirty(false); }}
                title="Nuevo producto"
                subtitle="Ejemplo con pestañas y panel lateral"
                breadcrumb={['Menú', 'Productos']}
                status={<Badge tone="primary" dot>Borrador</Badge>}
                tabs={[{ id: 'datos', label: 'Datos' }, { id: 'receta', label: 'Receta', badge: 4 }]}
                activeTab={modalTab}
                onTabChange={setModalTab}
                dirty={dirty}
                aside={<div><h3 style={{ margin: 0 }}>Resumen</h3><p style={{ color: 'var(--ui-text-muted)' }}>Costo estimado {formatMoney(48.2)}</p></div>}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" onClick={() => { setModal(false); setDirty(false); }}>Guardar</Button>
                    </>
                )}
            >
                <FormSection title={modalTab === 'datos' ? 'Datos generales' : 'Ingredientes'} step={1}>
                    <FormGrid>
                        <Field label="Nombre" htmlFor="pgm-name"><Input id="pgm-name" onChange={() => setDirty(true)} /></Field>
                        <Field label="Área" htmlFor="pgm-area"><AppSelect inputId="pgm-area" options={OPTIONS} value={single} onChange={(v) => { setSingle(v); setDirty(true); }} /></Field>
                    </FormGrid>
                </FormSection>
            </FullScreenModal>

            <Drawer isOpen={drawer} onClose={() => setDrawer(false)} title="Filtros" footer={<Button variant="primary" onClick={() => setDrawer(false)}>Aplicar</Button>}>
                <FormGrid columns="1fr">
                    <Field label="Estado" htmlFor="pgd-st"><AppSelect inputId="pgd-st" options={OPTIONS} value={single} onChange={setSingle} /></Field>
                    <Field label="Desde" htmlFor="pgd-from"><DateInput id="pgd-from" /></Field>
                </FormGrid>
            </Drawer>

            <ConfirmDialog
                isOpen={confirm}
                tone="danger"
                title="Eliminar producto"
                message="Esta acción no se puede deshacer."
                confirmLabel="Eliminar"
                onConfirm={() => setConfirm(false)}
                onCancel={() => setConfirm(false)}
            />
        </PageContent>
    );
}
