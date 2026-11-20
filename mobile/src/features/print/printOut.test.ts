import { printOrShare, printOut, PrinterUnavailable } from './printOut';

const share = vi.fn();
const writeFile = vi.fn();
const readdir = vi.fn();
const deleteFile = vi.fn();
vi.mock('@capacitor/share', () => ({ Share: { share: (...a: unknown[]) => share(...a) } }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: (...a: unknown[]) => writeFile(...a), readdir: (...a: unknown[]) => readdir(...a), deleteFile: (...a: unknown[]) => deleteFile(...a) }, Directory: { Cache: 'CACHE' } }));

beforeEach(() => {
    share.mockReset().mockResolvedValue({});
    readdir.mockReset().mockResolvedValue({ files: [] });
    deleteFile.mockReset().mockResolvedValue(undefined);
    writeFile.mockReset().mockResolvedValue({ uri: 'file:///cache/x.pdf' });
});

describe('printOut', () => {
    it('print falls back to share when no printer', async () => {
        const out = { print: vi.fn().mockRejectedValue(new PrinterUnavailable()), shareText: vi.fn().mockResolvedValue(undefined) };
        await expect(printOrShare(out, 'ticket')).resolves.toBe('shared');
        expect(out.shareText).toHaveBeenCalledWith('ticket');
        // The shipped print is the documented stub: it has no printer.
        await expect(printOut.print('x')).rejects.toBeInstanceOf(PrinterUnavailable);
    });

    it('a real print error is not swallowed into a share', async () => {
        const out = { print: vi.fn().mockRejectedValue(new Error('Bluetooth caído')), shareText: vi.fn() };
        await expect(printOrShare(out, 'ticket')).rejects.toThrow('Bluetooth caído');
        expect(out.shareText).not.toHaveBeenCalled();
    });

    it('shareText opens the share sheet and ignores a cancelled sheet', async () => {
        await printOut.shareText('hola');
        expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: 'hola' }));
        share.mockRejectedValueOnce(new Error('Share canceled'));
        await expect(printOut.shareText('hola')).resolves.toBeUndefined();
        share.mockRejectedValueOnce(new Error('boom'));
        await expect(printOut.shareText('hola')).rejects.toThrow('boom');
    });

    it('sharePdf writes the blob in the cache directory and shares the file', async () => {
        await printOut.sharePdf(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'factura 12/3.pdf');
        expect(writeFile).toHaveBeenCalledWith({ path: 'factura_12_3.pdf', data: btoa('%PDF-1.4'), directory: 'CACHE' });
        expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'file:///cache/x.pdf' }));
    });

    it('sharePdf removes cached PDFs older than a day, keeps recent ones and survives a cleanup failure', async () => {
        const now = Date.now();
        readdir.mockResolvedValue({ files: [{ name: 'factura-old.pdf', mtime: now - 3 * 86_400_000 }, { name: 'factura-new.pdf', mtime: now - 1000 }, { name: 'foto.jpg', mtime: now - 9 * 86_400_000 }] });
        await printOut.sharePdf(new Blob(['%PDF']), 'factura-1.pdf');
        expect(deleteFile).toHaveBeenCalledTimes(1);
        expect(deleteFile).toHaveBeenCalledWith({ path: 'factura-old.pdf', directory: 'CACHE' });
        readdir.mockRejectedValue(new Error('nope'));
        await printOut.sharePdf(new Blob(['%PDF']), 'factura-2.pdf');
        expect(share).toHaveBeenCalledTimes(2);
    });
});
