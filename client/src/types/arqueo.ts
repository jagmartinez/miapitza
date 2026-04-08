export interface Denomination {
    denomination: number;
    count: number;
}

export interface ArqueoData {
    bills: Denomination[];
    coins: Denomination[];
    notes?: string;
}

export interface ArqueoResult {
    counted: {
        bills: number;
        coins: number;
        total: number;
    };
    expected: number;
    difference: number;
    status: 'CUADRADO' | 'SOBRANTE' | 'FALTANTE';
    breakdown: {
        bills: Denomination[];
        coins: Denomination[];
    };
}
