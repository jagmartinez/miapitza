import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';

// Register fonts for a more professional look
Font.register({
    family: 'Helvetica-Bold',
    src: 'Helvetica-Bold'
});

const styles = StyleSheet.create({
    page: {
        padding: 25,
        fontFamily: 'Helvetica',
        fontSize: 10,
        color: '#2d3748',
        lineHeight: 1.25,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderBottom: 2,
        borderBottomColor: '#1a365d',
        paddingBottom: 10,
        marginBottom: 15,
    },
    companyInfo: {
        flexDirection: 'column',
    },
    companyName: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1a365d',
        marginBottom: 8,
    },
    companyDetail: {
        fontSize: 9,
        color: '#718096',
    },
    contractBadge: {
        backgroundColor: '#ebf8ff',
        padding: 8,
        borderRadius: 4,
        alignItems: 'flex-end',
    },
    title: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#2b6cb0',
        marginBottom: 6,
    },
    contractNumber: {
        fontSize: 10,
        color: '#4a5568',
    },
    section: {
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#2d3748',
        borderBottom: 1,
        borderBottomColor: '#e2e8f0',
        paddingBottom: 4,
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 15,
    },
    infoBlock: {
        flex: 1,
        minWidth: '45%',
    },
    row: {
        flexDirection: 'row',
        marginBottom: 6,
    },
    label: {
        width: 80,
        fontWeight: 'bold',
        color: '#4a5568',
        fontSize: 9,
    },
    value: {
        flex: 1,
        color: '#2d3748',
        fontSize: 10,
    },
    table: {
        marginTop: 10,
        borderRadius: 4,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: '#f8fafc',
        borderBottomWidth: 1,
        borderBottomColor: '#e2e8f0',
        padding: 8,
    },
    tableHeaderText: {
        fontWeight: 'bold',
        color: '#4a5568',
        fontSize: 9,
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#edf2f7',
        padding: 8,
        alignItems: 'center',
    },
    tableColMain: { flex: 3 },
    tableColSmall: { flex: 1, textAlign: 'center' },
    tableColPrice: { flex: 1, textAlign: 'right' },

    summarySection: {
        marginTop: 20,
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    summaryBox: {
        width: 200,
        backgroundColor: '#f8fafc',
        padding: 15,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    summaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    totalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#e2e8f0',
    },
    totalLabel: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#1a365d',
    },
    totalValue: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#2b6cb0',
    },
    termsSection: {
        marginTop: 10,
        padding: 8,
        backgroundColor: '#fdfdfd',
        borderWidth: 1,
        borderColor: '#f0f0f0',
        borderRadius: 4,
    },
    clausesColumn: {
        flex: 1,
        flexDirection: 'column',
    },
    termsTitle: {
        fontSize: 10,
        fontWeight: 'bold',
        marginBottom: 6,
        color: '#4a5568',
    },
    termsText: {
        fontSize: 8,
        color: '#718096',
        textAlign: 'justify',
        marginBottom: 2,
    },
    signatureSection: {
        marginTop: 50,
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    signatureBlock: {
        width: '40%',
        alignItems: 'center',
    },
    signatureLine: {
        width: '100%',
        borderTopWidth: 1,
        borderTopColor: '#2d3748',
        marginTop: 40,
        marginBottom: 8,
    },
    signatureLabel: {
        fontSize: 9,
        fontWeight: 'bold',
    },
    signatureSublabel: {
        fontSize: 8,
        color: '#718096',
    },
    pageNumber: {
        position: 'absolute',
        bottom: 30,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontSize: 8,
        color: '#cbd5e0',
    }
});

interface ContractCustomer {
    name?: string;
    taxId?: string;
    phone?: string;
}

interface ContractServiceLine {
    quantity: number | string;
    unitPrice: number | string;
    notes?: string;
    service?: { name?: string };
}

interface ContractMenuLine {
    quantity: number | string;
    unitPrice: number | string;
    notes?: string;
    menuItem?: { name?: string };
}

interface ContractClauses {
    manifiestan?: string;
    objetoContrato?: string;
    duracionServicio?: string;
    gastosServicio?: string;
    demoraPago?: string;
    obligacionesProveedor?: string;
    obligacionesCliente?: string;
}

interface ContractEvent {
    id: number;
    title?: string;
    date: string | Date;
    peopleCount?: number | string;
    totalAmount: number | string;
    balance?: number | string;
    customer?: ContractCustomer;
    services?: ContractServiceLine[];
    menuItems?: ContractMenuLine[];
    clauses?: ContractClauses;
}

interface ContractSettings {
    companyName?: string;
    nif?: string;
    address?: string;
    phone?: string;
    email?: string;
    currency_symbol?: string;
}

interface ContractProps {
    event: ContractEvent;
    settings?: ContractSettings;
}

const ContractPDF = ({ event, settings = {} }: ContractProps) => {
    const subtotal = Number(event.totalAmount) / 1.15;
    const tax = Number(event.totalAmount) - subtotal;

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                {/* Header with Professional Branding */}
                <View style={styles.header}>
                    <View style={styles.companyInfo}>
                        <Text style={styles.companyName}>{settings.companyName || 'SISTEMA GASTRO PRO'}</Text>
                        <Text style={styles.companyDetail}>RUC: {settings.nif || '0999999999001'}</Text>
                        <Text style={styles.companyDetail}>{settings.address || 'Av. Principal 123, Edificio Blue Tower'}</Text>
                        <Text style={styles.companyDetail}>Tel: {settings.phone || '(04) 220-4567'} | {settings.email || 'info@gastropro.com'}</Text>
                    </View>
                    <View style={styles.contractBadge}>
                        <Text style={styles.title}>CONTRATO DE CATERING</Text>
                        <Text style={styles.contractNumber}>Orden No: #EVT-{event.id.toString().padStart(5, '0')}</Text>
                        <Text style={styles.companyDetail}>Fecha de Emisión: {new Date().toLocaleDateString()}</Text>
                    </View>
                </View>

                {/* Main Information Grid */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Información General</Text>
                    <View style={styles.grid}>
                        <View style={styles.infoBlock}>
                            <View style={styles.row}>
                                <Text style={styles.label}>Contratante:</Text>
                                <Text style={styles.value}>{event.customer?.name}</Text>
                            </View>
                            <View style={styles.row}>
                                <Text style={styles.label}>Cédula/RUC:</Text>
                                <Text style={styles.value}>{event.customer?.taxId || 'N/A'}</Text>
                            </View>
                            <View style={styles.row}>
                                <Text style={styles.label}>Contacto:</Text>
                                <Text style={styles.value}>{event.customer?.phone}</Text>
                            </View>
                        </View>
                        <View style={styles.infoBlock}>
                            <View style={styles.row}>
                                <Text style={styles.label}>Evento:</Text>
                                <Text style={styles.value}>{event.title}</Text>
                            </View>
                            <View style={styles.row}>
                                <Text style={styles.label}>Fecha Evento:</Text>
                                <Text style={styles.value}>{new Date(event.date).toLocaleDateString('es-ES', { dateStyle: 'long' })}</Text>
                            </View>
                            <View style={styles.row}>
                                <Text style={styles.label}>Asistentes:</Text>
                                <Text style={styles.value}>{event.peopleCount} personas</Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Items and Services Table */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Detalles de Servicios y Menú</Text>
                    <View style={styles.table}>
                        <View style={styles.tableHeader}>
                            <View style={styles.tableColMain}><Text style={styles.tableHeaderText}>Descripción del Servicio / Producto</Text></View>
                            <View style={styles.tableColSmall}><Text style={styles.tableHeaderText}>Cant.</Text></View>
                            <View style={styles.tableColPrice}><Text style={styles.tableHeaderText}>P. Unit</Text></View>
                            <View style={styles.tableColPrice}><Text style={styles.tableHeaderText}>Total</Text></View>
                        </View>

                        {/* Services List */}
                        {event.services?.map((s, i: number) => (
                            <View key={`s-${i}`} style={styles.tableRow}>
                                <View style={styles.tableColMain}><Text>{s.service?.name || s.notes || 'Servicio'}</Text></View>
                                <View style={styles.tableColSmall}><Text>{s.quantity}</Text></View>
                                <View style={[styles.tableColPrice, { color: '#718096' }]}><Text>{settings.currency_symbol || '$'}{Number(s.unitPrice).toFixed(2)}</Text></View>
                                <View style={styles.tableColPrice}><Text>{settings.currency_symbol || '$'}{(Number(s.quantity) * Number(s.unitPrice)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text></View>
                            </View>
                        ))}

                        {/* Menu Items List */}
                        {event.menuItems?.map((m, i: number) => (
                            <View key={`m-${i}`} style={styles.tableRow}>
                                <View style={styles.tableColMain}>
                                    <Text>{m.menuItem?.name || 'Plato'}</Text>
                                    {m.notes && <Text style={{ fontSize: 7, color: '#a0aec0' }}>{m.notes}</Text>}
                                </View>
                                <View style={styles.tableColSmall}><Text>{m.quantity}</Text></View>
                                <View style={[styles.tableColPrice, { color: '#718096' }]}><Text>{settings.currency_symbol || '$'}{Number(m.unitPrice).toFixed(2)}</Text></View>
                                <View style={styles.tableColPrice}><Text>{settings.currency_symbol || '$'}{(Number(m.quantity) * Number(m.unitPrice)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text></View>
                            </View>
                        ))}
                    </View>
                </View>

                {/* Financial Summary Box */}
                <View style={styles.summarySection}>
                    <View style={styles.summaryBox}>
                        <View style={styles.summaryRow}>
                            <Text style={{ color: '#718096' }}>Subtotal:</Text>
                            <Text>{settings.currency_symbol || '$'}{subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                        </View>
                        <View style={styles.summaryRow}>
                            <Text style={{ color: '#718096' }}>IVA (15%):</Text>
                            <Text>{settings.currency_symbol || '$'}{tax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                        </View>
                        <View style={styles.totalRow}>
                            <Text style={styles.totalLabel}>TOTAL:</Text>
                            <Text style={styles.totalValue}>{settings.currency_symbol || '$'}{Number(event.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
                        </View>
                        <View style={[styles.summaryRow, { marginTop: 10 }]}>
                            <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#e53e3e' }}>SALDO PENDIENTE:</Text>
                            <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#e53e3e' }}>{settings.currency_symbol || '$'}{Number(event.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
                        </View>
                    </View>
                </View>

                {/* Dynamic Contract Clauses */}
                {event.clauses && (
                    <View style={styles.termsSection} break>
                        <Text style={styles.sectionTitle}>Compromisos y Cláusulas</Text>
                        <View style={{ flexDirection: 'column' }}>
                            {event.clauses.manifiestan && (
                                <View style={{ marginBottom: 12 }}>
                                    <Text style={[styles.termsText, { fontWeight: 'bold', color: '#4a5568' }]}>I. MANIFIESTAN:</Text>
                                    <Text style={styles.termsText}>{event.clauses.manifiestan}</Text>
                                </View>
                            )}

                            {event.clauses.objetoContrato && (
                                <View style={{ marginBottom: 12 }}>
                                    <Text style={[styles.termsText, { fontWeight: 'bold', color: '#4a5568' }]}>II. OBJETO DEL CONTRATO:</Text>
                                    <Text style={styles.termsText}>{event.clauses.objetoContrato}</Text>
                                </View>
                            )}

                            {event.clauses.duracionServicio && (
                                <View style={{ marginBottom: 12 }}>
                                    <Text style={[styles.termsText, { fontWeight: 'bold', color: '#4a5568' }]}>III. DURACIÓN DEL SERVICIO:</Text>
                                    <Text style={styles.termsText}>{event.clauses.duracionServicio}</Text>
                                </View>
                            )}

                            {event.clauses.gastosServicio && (
                                <View style={{ marginBottom: 12 }}>
                                    <Text style={[styles.termsText, { fontWeight: 'bold', color: '#4a5568' }]}>IV. GASTOS DURANTE EL SERVICIO:</Text>
                                    <Text style={styles.termsText}>{event.clauses.gastosServicio}</Text>
                                </View>
                            )}

                            {event.clauses.demoraPago && (
                                <View style={{ marginBottom: 12 }}>
                                    <Text style={[styles.termsText, { fontWeight: 'bold', color: '#4a5568' }]}>V. DEMORA DE PAGO:</Text>
                                    <Text style={styles.termsText}>{event.clauses.demoraPago}</Text>
                                </View>
                            )}

                            {event.clauses.obligacionesProveedor && (
                                <View style={{ marginBottom: 12 }}>
                                    <Text style={[styles.termsText, { fontWeight: 'bold', color: '#4a5568' }]}>VI. OBLIGACIONES DEL PROVEEDOR:</Text>
                                    <Text style={styles.termsText}>{event.clauses.obligacionesProveedor}</Text>
                                </View>
                            )}

                            {event.clauses.obligacionesCliente && (
                                <View style={{ marginBottom: 12 }}>
                                    <Text style={[styles.termsText, { fontWeight: 'bold', color: '#4a5568' }]}>VII. OBLIGACIONES DEL CLIENTE:</Text>
                                    <Text style={styles.termsText}>{event.clauses.obligacionesCliente}</Text>
                                </View>
                            )}
                        </View>
                    </View>
                )}

                {/* Fullback or Supplemental Terms if no dynamic clauses */}
                {!event.clauses && (
                    <View style={styles.termsSection}>
                        <Text style={styles.termsTitle}>Términos y Condiciones Generales</Text>
                        <Text style={styles.termsText}>
                            1. RESERVA: Se requiere el pago del 50% para confirmación formal. El saldo restante deberá cancelarse 48 horas antes del evento.
                        </Text>
                        <Text style={styles.termsText}>
                            2. CANCELACIONES: Más de 15 días: devolución 80%. Menos de 7 días: no hay derecho a devolución.
                        </Text>
                        <Text style={styles.termsText}>
                            3. DAÑOS: El cliente responde por daños a equipos o mantelería que excedan el uso normal.
                        </Text>
                    </View>
                )}

                {/* Signature Sections */}
                <View style={styles.signatureSection}>
                    <View style={styles.signatureBlock}>
                        <View style={styles.signatureLine} />
                        <Text style={styles.signatureLabel}>{event.customer?.name}</Text>
                        <Text style={styles.signatureSublabel}>CONTRATANTE</Text>
                    </View>
                    <View style={styles.signatureBlock}>
                        <View style={styles.signatureLine} />
                        <Text style={styles.signatureLabel}>REPRESENTANTE LEGAL</Text>
                        <Text style={styles.signatureSublabel}>{settings.companyName || 'SISTEMA GASTRO PRO'}</Text>
                    </View>
                </View>

                <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => (
                    `Página ${pageNumber} de ${totalPages}`
                )} fixed />
            </Page>
        </Document>
    );
};

export default ContractPDF;
