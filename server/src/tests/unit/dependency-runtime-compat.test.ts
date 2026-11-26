import { once } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from '@jest/globals';
import ExcelJS from 'exceljs';

import { swaggerSpec } from '../../utils/swagger';

describe('production dependency runtime compatibility', () => {
    it('builds the OpenAPI document from repository-owned route patterns', () => {
        expect(swaggerSpec).toEqual(expect.objectContaining({
            openapi: '3.0.0',
            paths: expect.any(Object),
        }));
    });

    it('round-trips an XLSX buffer through the non-streaming API', async () => {
        const source = new ExcelJS.Workbook();
        source.addWorksheet('Datos').addRow(['sku', 'cantidad']);
        const serialized = Buffer.from(await source.xlsx.writeBuffer());

        const loaded = new ExcelJS.Workbook();
        await (loaded.xlsx.load as unknown as (
            buffer: Buffer,
        ) => Promise<ExcelJS.Workbook>)(serialized);

        expect(loaded.getWorksheet('Datos')?.getRow(1).values).toEqual([
            undefined,
            'sku',
            'cantidad',
        ]);
    });

    it('round-trips an XLSX through the overridden streaming writer and reader', async () => {
        const sink = new PassThrough();
        const chunks: Buffer[] = [];
        sink.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        const finished = once(sink, 'finish');

        const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink });
        writer.addWorksheet('Datos').addRow(['sku', 'cantidad']).commit();
        await writer.commit();
        await finished;

        const reader = new ExcelJS.stream.xlsx.WorkbookReader(
            Readable.from([Buffer.concat(chunks)]),
            {},
        );
        const rows: unknown[][] = [];
        for await (const worksheet of reader) {
            for await (const row of worksheet) rows.push(row.values as unknown[]);
        }

        expect(rows).toEqual([[undefined, 'sku', 'cantidad']]);
    });
});
