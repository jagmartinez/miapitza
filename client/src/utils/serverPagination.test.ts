import { describe, expect, it } from 'vitest';
import { readServerPagination } from './serverPagination';

describe('readServerPagination', () => {
    it('derives total pages from the server envelope', () => {
        expect(readServerPagination({ data: [], pagination: { page: 2, limit: 50, total: 120 } }, 50, 50))
            .toEqual({ page: 2, limit: 50, total: 120, totalPages: 3 });
    });

    it('honours an explicit totalPages and the server-capped limit', () => {
        expect(readServerPagination({ pagination: { page: 1, limit: 200, total: 900, totalPages: 5 } }, 200, 500))
            .toEqual({ page: 1, limit: 200, total: 900, totalPages: 5 });
    });

    it('never invents pages when the envelope is missing (cached or legacy payloads)', () => {
        expect(readServerPagination({ data: [] }, 7, 20, 1)).toEqual({ page: 1, limit: 20, total: 7, totalPages: 1 });
        expect(readServerPagination(null, 0, 20)).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
    });
});
