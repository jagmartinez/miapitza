import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import prisma from '../../utils/prisma';
import { fileCleanupService } from '../../services/file-cleanup.service';
import { sanitizeLogoFilename, UploadController } from '../../controllers/upload.controller';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('sanitizeLogoFilename', () => {
  it('accepts generated logo filenames with allowed extensions', () => {
    expect(sanitizeLogoFilename('logo-1712345678-123456789.png')).toBe('logo-1712345678-123456789.png');
  });

  it('rejects path traversal attempts', () => {
    expect(sanitizeLogoFilename('../logo-1712345678-123456789.png')).toBeNull();
  });

  it('rejects svg uploads even if the name matches the prefix', () => {
    expect(sanitizeLogoFilename('logo-1712345678-123456789.svg')).toBeNull();
  });
});

describe('UploadController.deleteLogo', () => {
  it('unlinks the DB reference and enqueues cleanup in the same transaction', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([] as never),
      company: {
        findFirst: jest.fn().mockResolvedValue({ id: 3 } as never),
        update: jest.fn().mockResolvedValue({ id: 3, logo: null } as never),
      },
    };
    jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) =>
      callback(tx as never) as never);
    const enqueue = jest.spyOn(fileCleanupService, 'requestDeletion').mockResolvedValue();
    const process = jest.spyOn(fileCleanupService, 'processByStorageKey').mockResolvedValue(true);
    const res = {
      json: jest.fn(),
    } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction;

    await UploadController.deleteLogo({
      params: { filename: 'logo-1712345678-123456789.png' },
      user: { companyId: 3 },
    } as unknown as Request, res, next);

    expect(tx.company.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { logo: null },
    });
    expect(enqueue).toHaveBeenCalledWith(
      tx as never,
      3,
      'LOGO',
      'logo-1712345678-123456789.png',
      'COMPANY_LOGO_DELETED',
    );
    expect(process.mock.invocationCallOrder[0]).toBeGreaterThan(enqueue.mock.invocationCallOrder[0]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(next).not.toHaveBeenCalled();
  });
});
