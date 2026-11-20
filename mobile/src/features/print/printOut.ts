/**
 * Output adapter of the app: what leaves the tablet as paper or as a file.
 *
 *  - `print(text)`: ESC/POS to a thermal printer. SHIPPED AS A STUB: it always throws `PrinterUnavailable`. The real
 *    Bluetooth / network driver (ESC/POS bytes over RFCOMM or a raw TCP socket on 9100) is chosen at the device gate with
 *    the actual printer, and replaces `print` below without touching any caller.
 *  - `shareText(text)`: Android share sheet with the plain text (WhatsApp, mail, a print service...).
 *  - `sharePdf(blob, name)`: writes the file in the app cache and shares it.
 *
 * Callers use `printOrShare`, which falls back to the share sheet when there is no printer.
 * The Capacitor plugins are imported lazily, so they stay out of the initial bundle.
 */
export class PrinterUnavailable extends Error {
    constructor(message = 'No hay impresora conectada.') {
        super(message);
        this.name = 'PrinterUnavailable';
    }
}

export interface PrintOut {
    print(text: string): Promise<void>;
    shareText(text: string): Promise<void>;
    sharePdf(blob: Blob, name: string): Promise<void>;
}

/** The user closed the share sheet without choosing anything: not an error. */
const isCancelled = (error: unknown) => /cancel/i.test(error instanceof Error ? error.message : String(error));

function toBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo.'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.readAsDataURL(blob);
    });
}

/** A file name the file system accepts. */
const safeName = (name: string) => name.replace(/[^\w.\-]+/g, '_') || 'documento.pdf';

export const printOut: PrintOut = {
    async print() {
        throw new PrinterUnavailable();
    },
    async shareText(text) {
        const { Share } = await import('@capacitor/share');
        try {
            await Share.share({ title: 'Cierre de caja', text, dialogTitle: 'Enviar' });
        } catch (error) {
            if (!isCancelled(error)) throw error;
        }
    },
    async sharePdf(blob, name) {
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
        const file = safeName(name);
        const { uri } = await Filesystem.writeFile({ path: file, data: await toBase64(blob), directory: Directory.Cache });
        try {
            await Share.share({ title: file, url: uri, dialogTitle: 'Enviar' });
        } catch (error) {
            if (!isCancelled(error)) throw error;
        }
    },
};

/** Print; with no printer, offer the share sheet instead. Any other failure is the caller's to show. */
export async function printOrShare(out: Pick<PrintOut, 'print' | 'shareText'>, text: string): Promise<'printed' | 'shared'> {
    try {
        await out.print(text);
        return 'printed';
    } catch (error) {
        if (!(error instanceof PrinterUnavailable)) throw error;
        await out.shareText(text);
        return 'shared';
    }
}
