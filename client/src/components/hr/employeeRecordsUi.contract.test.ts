import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
const detail = read('../../pages/hr/EmployeeDetail.tsx');
const panel = read('./EmployeeRecordPanel.tsx');
const form = read('./EmployeeForm.tsx');
const client = read('./hrClient.ts');

describe('employee employment-record UI contract', () => {
  it('exposes contracts, compensation history and document custody from the employee file', () => {
    expect(detail).toContain("tab('contracts', 'Contratos'");
    expect(detail).toContain("tab('compensation', 'Compensación'");
    expect(detail).toContain("tab('documents', 'Documentos'");
    expect(detail).toContain('EmployeeRecordPanel');
  });

  it('keeps contractual transitions and compensation append-only through server endpoints', () => {
    expect(panel).toContain('transitionEmployeeContract');
    expect(panel).toContain('appendEmployeeCompensation');
    expect(panel).toContain('Nueva versión de compensación');
    expect(client).toContain('/contracts/${contractId}/transition');
    expect(client).toContain('/compensations`');
  });

  it('uses multipart custody and explicit verified download/revocation flows', () => {
    expect(client).toContain("form.append('document', payload.file)");
    expect(panel).toContain('El servidor valida firma, tamaño y SHA-256');
    expect(client).toContain('/documents/${document.id}/download');
    expect(client).toContain('/documents/${documentId}/revoke');
  });

  it('captures the statutory identifiers and emergency data required before payroll', () => {
    for (const field of ['socialSecurityNumber', 'taxId', 'documentType', 'preferredName', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship']) {
      expect(form).toContain(field);
    }
    expect(form).toContain('Obligatorio para calcular una corrida');
  });
});
