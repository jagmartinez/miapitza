export type StrOption = { value: string; label: string };

export const BANK_OPTIONS: StrOption[] = [
    { value: 'BAC', label: 'BAC' },
    { value: 'BANPRO', label: 'BANPRO' },
    { value: 'LAFISE', label: 'LAFISE' },
    { value: 'FICOHSA', label: 'FICOHSA' },
    { value: 'AVANZ', label: 'AVANZ' },
    { value: 'ATLANTIDA', label: 'ATLANTIDA' },
    { value: 'EFECTIVO', label: 'EFECTIVO' },
    { value: 'OTRO', label: 'OTRO' },
];

export const INVOICE_TYPE_OPTIONS: StrOption[] = [
    { value: 'CASH', label: 'Contado' },
    { value: 'CREDIT', label: 'Crédito' },
];
