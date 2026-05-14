import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import branchRoutes from './routes/branch.routes';
import tableRoutes from './routes/table.routes';
import reservationRoutes from './routes/reservation.routes';
import productRoutes from './routes/product.routes';
import menuItemRoutes from './routes/menu-item.routes';
import warehouseRoutes from './routes/warehouse.routes';
import inventoryMovementRoutes from './routes/inventory-movement.routes';
import supplierRoutes from './routes/supplier.routes';
import purchaseOrderRoutes from './routes/purchase-order.routes';
import orderRoutes from './routes/order.routes';
import paymentRoutes from './routes/payment.routes';
import cashRegisterRoutes from './routes/cash-register.routes';
import cashShiftRoutes from './routes/cash-shift.routes';
import reportRoutes from './routes/report.routes';
import settingRoutes from './routes/setting.routes';
import roleRoutes from './routes/role.routes';
import permissionRoutes from './routes/permission.routes';
import uploadRoutes from './routes/upload.routes';
import backupRoutes from './routes/backup.routes';
import exportRoutes from './routes/export.routes';
import modifierRoutes from './routes/modifier.routes';
import companyRoutes from './routes/company.routes';
import deliveryRoutes from './routes/delivery.routes';
import stockAlertRoutes from './routes/stock-alert.routes';
import promotionRoutes from './routes/promotion.routes';
import cashArqueoRoutes from './routes/cash-arqueo.routes';
import splitBillRoutes from './routes/split-bill.routes';
import advancedFeaturesRoutes from './routes/advanced-features.routes';
import cateringRoutes from './routes/catering.routes';
import categoryRoutes from './routes/category.routes';
import { errorHandler } from './middlewares/errorHandler';
import { idempotency } from './middlewares/idempotency';
import { csrfProtection } from './middlewares/csrf';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './utils/swagger';
import invoiceRoutes from './routes/invoice.routes';
import kardexRoutes from './routes/kardex.routes';
import v1Router from './routes/v1.router';
import unitConversionRoutes from './routes/unit-conversion.routes';

dotenv.config();

const app: Express = express();

// Liveness for load balancers (Railway, etc.) — minimal stack, no DB
app.get('/health', (_req, res) => {
    res.status(200).type('text/plain').send('ok');
});

// Trust proxy for correct IP detection behind reverse proxy
app.set('trust proxy', 1);

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' } // Allow uploads to be served cross-origin
}));
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
        (req as Request).rawBody = buf.toString('utf8');
    }
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// CSRF protection (double-submit cookie) — skips API-key requests
app.use('/api', csrfProtection);

// Idempotency — deduplicates POST/PUT/PATCH with X-Idempotency-Key header
app.use('/api', idempotency);

// Protect uploads with authentication — require valid JWT to access uploaded files
import path from 'path';
import { auth as authMiddlewareForUploads } from './middlewares/auth';
app.use('/uploads', authMiddlewareForUploads, express.static(path.resolve(__dirname, '..', 'uploads')));

// Swagger docs — protected by basic auth in production
const swaggerAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (process.env.NODE_ENV !== 'production') return next();
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
        res.set('WWW-Authenticate', 'Basic realm="API Docs"');
        return res.status(401).send('Authentication required');
    }
    const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    if (user === (process.env.DOCS_USER || 'admin') && pass === process.env.DOCS_PASSWORD) {
        return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="API Docs"');
    return res.status(401).send('Invalid credentials');
};
app.use('/api/docs', swaggerAuth, swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Validate :id params globally (reject NaN before hitting controllers)
app.param('id', (req, res, next, value) => {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid ID: must be a positive integer' });
    }
    next();
});

// Rate limiting for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // max 20 attempts per window
    message: { success: false, message: 'Too many attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false
});

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/products', productRoutes);
app.use('/api/menu-items', menuItemRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/inventory-movements', inventoryMovementRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/cash-registers', cashRegisterRoutes);
app.use('/api/cash-shifts', cashShiftRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/modifiers', modifierRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/stock-alerts', stockAlertRoutes);
app.use('/api/promotions', promotionRoutes);
app.use('/api/cash-arqueo', cashArqueoRoutes);
app.use('/api/split-bill', splitBillRoutes);
app.use('/api/advanced', advancedFeaturesRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/reports/kardex', kardexRoutes);
app.use('/api/catering', cateringRoutes);
app.use('/api/units', unitConversionRoutes);

// API v1 versioned router (new endpoints go here)
app.use('/api/v1', v1Router);

// Health check — do not expose internal operational details
app.get('/api/health', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        message: 'Restaurant System API is running',
        timestamp: new Date().toISOString()
    });
});

// Error handling middleware (must be last)
app.use(errorHandler);

export default app;

