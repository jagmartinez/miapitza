import { Request, Response, NextFunction } from 'express';
import { PurchaseOrderImportService } from '../services/purchase-order-import.service';
import { getErrorMessage } from '../utils/error';

export class PurchaseOrderImportController {

    /**
     * Responds with the Excel template for download
     */
    static async getTemplate(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const buffer = await PurchaseOrderImportService.generateTemplate(companyId);

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=Plantilla_Orden_Compra.xlsx');
            res.send(buffer);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    /**
     * Validates an uploaded Excel file and returns preview data
     */
    static async validate(req: Request, res: Response, next: NextFunction) {
        try {
            if (!req.file) {
                return next({ statusCode: 400, message: 'No se ha subido ningún archivo' });
            }

            const companyId = req.user!.companyId;
            const results = await PurchaseOrderImportService.validateExcel(req.file.buffer, companyId);

            res.json({
                success: true,
                data: results
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: `Error al procesar archivo: ${getErrorMessage(error)}` });
        }
    }

    /**
     * Confirms the import and creates the purchase order
     */
    static async confirm(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const order = await PurchaseOrderImportService.confirmImport(companyId, req.body);

            res.json({
                success: true,
                message: 'Orden de compra creada exitosamente',
                data: order
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: `Error al confirmar importación: ${getErrorMessage(error)}` });
        }
    }
}
