import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './hooks/useAuth';
import './styles/responsive.css';
import Login from './pages/Login';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';

import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider } from './context/LanguageContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { getUserRoleNames } from './utils/authz';

/** Route guard: redirects to /dashboard if none of the user's roles are in the allowed list */
function RoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
    const { user } = useAuth();
    if (!user) return <Navigate to="/dashboard" replace />;
    const userRoleNames = getUserRoleNames(user);
    const hasAccess = userRoleNames.some(rn => roles.includes(rn));
    if (!hasAccess) return <Navigate to="/dashboard" replace />;
    return <>{children}</>;
}

// Role shorthands
const ADMIN = ['SUPERADMIN', 'ADMIN'];
const OPS = ['SUPERADMIN', 'ADMIN', 'CAJERO', 'MESERO'];
const CASHIER = ['SUPERADMIN', 'ADMIN', 'CAJERO'];
const WAITER_TABLE = ['SUPERADMIN', 'ADMIN', 'MESERO', 'HOST'];
const KITCHEN_ROLES = ['SUPERADMIN', 'ADMIN', 'MESERO', 'COCINA', 'CHEF'];
const HOST_ROLES = ['SUPERADMIN', 'ADMIN', 'HOST', 'CAJERO'];
const WAREHOUSE = ['SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'];
const CHEF_MGMT = ['SUPERADMIN', 'ADMIN', 'CHEF'];

// Lazy-loaded pages (code-split per route)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const POS = lazy(() => import('./pages/POS'));
const Tables = lazy(() => import('./pages/Tables'));
const Kitchen = lazy(() => import('./pages/Kitchen'));
const Users = lazy(() => import('./pages/Users'));
const Menu = lazy(() => import('./pages/Menu'));
const Orders = lazy(() => import('./pages/Orders'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const PurchaseOrderForm = lazy(() => import('./pages/PurchaseOrderForm'));
const CashRegisters = lazy(() => import('./pages/CashRegisters'));
const CashShiftPage = lazy(() => import('./pages/CashShift'));
const Branches = lazy(() => import('./pages/Branches'));
const Settings = lazy(() => import('./pages/Settings'));
const RolesPermissions = lazy(() => import('./pages/RolesPermissions'));
const Reservations = lazy(() => import('./pages/Reservations'));
const InvoiceHistory = lazy(() => import('./pages/InvoiceHistory'));
const Companies = lazy(() => import('./pages/Companies'));
const WasteReport = lazy(() => import('./pages/WasteReport'));
const BankReconciliation = lazy(() => import('./pages/BankReconciliation'));
const Kardex = lazy(() => import('./pages/Kardex'));
const Catering = lazy(() => import('./pages/Catering'));
const CateringServices = lazy(() => import('./pages/CateringServices'));
const Categories = lazy(() => import('./pages/Categories'));
const Promotions = lazy(() => import('./pages/Promotions'));
const WarehousesPage = lazy(() => import('./pages/Warehouses'));
const CostReport = lazy(() => import('./pages/CostReport'));
const Reports = lazy(() => import('./pages/Reports'));
const Profile = lazy(() => import('./pages/Profile'));
const ChangePassword = lazy(() => import('./pages/ChangePassword'));

function App() {
    return (
        <ErrorBoundary>
        <ThemeProvider>
            <LanguageProvider>
                <AuthProvider>
                    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                      <Suspense fallback={<LoadingSpinner />}>
                        <Routes>
                            <Route path="/login" element={<Login />} />

                            {/* Force password change (no layout, full-screen) */}
                            <Route path="/change-password" element={
                                <PrivateRoute><ChangePassword /></PrivateRoute>
                            } />

                            <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
                                {/* Open to all authenticated users */}
                                <Route path="/dashboard" element={<Dashboard />} />
                                <Route path="/profile" element={<Profile />} />
                                <Route path="/manual" element={<Navigate to="/manual-usuario.html" replace />} />

                                {/* Operations – role-restricted */}
                                <Route path="/pos" element={<RoleGuard roles={OPS}><POS /></RoleGuard>} />
                                <Route path="/tables" element={<RoleGuard roles={WAITER_TABLE}><Tables /></RoleGuard>} />
                                <Route path="/kitchen" element={<RoleGuard roles={KITCHEN_ROLES}><Kitchen /></RoleGuard>} />
                                <Route path="/orders" element={<RoleGuard roles={OPS}><Orders /></RoleGuard>} />
                                <Route path="/reservations" element={<RoleGuard roles={HOST_ROLES}><Reservations /></RoleGuard>} />
                                <Route path="/cash-registers" element={<RoleGuard roles={CASHIER}><CashRegisters /></RoleGuard>} />
                                <Route path="/cash-shifts/:id" element={<RoleGuard roles={CASHIER}><CashShiftPage /></RoleGuard>} />
                                <Route path="/invoices" element={<RoleGuard roles={CASHIER}><InvoiceHistory /></RoleGuard>} />

                                {/* Management – admin + chef */}
                                <Route path="/menu" element={<RoleGuard roles={CHEF_MGMT}><Menu /></RoleGuard>} />
                                <Route path="/catering" element={<RoleGuard roles={CASHIER}><Catering /></RoleGuard>} />
                                <Route path="/catering-services" element={<RoleGuard roles={CASHIER}><CateringServices /></RoleGuard>} />
                                <Route path="/categories" element={<RoleGuard roles={CHEF_MGMT}><Categories /></RoleGuard>} />
                                <Route path="/promotions" element={<RoleGuard roles={ADMIN}><Promotions /></RoleGuard>} />
                                <Route path="/inventory" element={<RoleGuard roles={WAREHOUSE}><Inventory /></RoleGuard>} />
                                <Route path="/kardex" element={<RoleGuard roles={WAREHOUSE}><Kardex /></RoleGuard>} />
                                <Route path="/suppliers" element={<RoleGuard roles={WAREHOUSE}><Suppliers /></RoleGuard>} />
                                <Route path="/purchase-orders" element={<RoleGuard roles={WAREHOUSE}><PurchaseOrders /></RoleGuard>} />
                                <Route path="/purchase-orders/new" element={<RoleGuard roles={['SUPERADMIN', 'ADMIN', 'BODEGA']}><PurchaseOrderForm /></RoleGuard>} />
                                <Route path="/purchase-orders/:id" element={<RoleGuard roles={['SUPERADMIN', 'ADMIN', 'BODEGA']}><PurchaseOrderForm /></RoleGuard>} />
                                <Route path="/warehouses" element={<RoleGuard roles={WAREHOUSE}><WarehousesPage /></RoleGuard>} />
                                <Route path="/cost-report" element={<RoleGuard roles={ADMIN}><CostReport /></RoleGuard>} />
                                <Route path="/reporteria" element={<RoleGuard roles={ADMIN}><Reports /></RoleGuard>} />
                                <Route path="/reporteria/:reportId" element={<RoleGuard roles={ADMIN}><Reports /></RoleGuard>} />
                                <Route path="/users" element={<RoleGuard roles={ADMIN}><Users /></RoleGuard>} />
                                <Route path="/waste-report" element={<RoleGuard roles={ADMIN}><WasteReport /></RoleGuard>} />
                                <Route path="/bank-reconciliation" element={<RoleGuard roles={ADMIN}><BankReconciliation /></RoleGuard>} />

                                {/* Configuration – admin/superadmin */}
                                <Route path="/branches" element={<RoleGuard roles={ADMIN}><Branches /></RoleGuard>} />
                                <Route path="/settings" element={<RoleGuard roles={ADMIN}><Settings /></RoleGuard>} />
                                <Route path="/roles-permissions" element={<RoleGuard roles={ADMIN}><RolesPermissions /></RoleGuard>} />
                                <Route path="/companies" element={<RoleGuard roles={['SUPERADMIN']}><Companies /></RoleGuard>} />
                            </Route>

                            <Route path="/" element={<Navigate to="/dashboard" replace />} />
                            <Route path="*" element={<Navigate to="/dashboard" replace />} />
                        </Routes>
                      </Suspense>
                    </BrowserRouter>
                </AuthProvider>
            </LanguageProvider>
        </ThemeProvider>
        </ErrorBoundary>
    );
}

export default App;
