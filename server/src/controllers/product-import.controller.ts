import { Request, Response, NextFunction } from 'express';
import { ProductImportService } from '../services/product-import.service';
import { getErrorMessage } from '../utils/error';

export class ProductImportController {
    static async getTemplate(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const buffer = await ProductImportService.generateTemplate(companyId);

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=Plantilla_Productos.xlsx');
            res.send(buffer);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async validate(req: Request, res: Response, next: NextFunction) {
        try {
            if (!req.file) {
                return next({ statusCode: 400, message: 'No se ha subido ningún archivo' });
            }

            const companyId = req.user!.companyId;
            const results = await ProductImportService.validateExcel(req.file.buffer, companyId);

            res.json({ success: true, data: results });
        } catch (error: unknown) {
            next({ statusCode: 400, message: `Error al procesar archivo: ${getErrorMessage(error)}` });
        }
    }

    static async confirm(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const { items } = req.body;

            if (!Array.isArray(items) || items.length === 0) {
                return next({ statusCode: 400, message: 'No hay productos para importar' });
            }

            const result = await ProductImportService.confirmImport(companyId, items);

            res.json({
                success: true,
                message: `Importación completada: ${result.created} creados, ${result.updated} actualizados`,
                data: result,
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: `Error al confirmar importación: ${getErrorMessage(error)}` });
        }
    }
}
