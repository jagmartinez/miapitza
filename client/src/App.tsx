import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CurrencyProvider } from './context/CurrencyContext';
import { useAuth } from './hooks/useAuth';
import './styles/responsive.css';
import Login from './pages/Login';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';

import { ThemeProvider } from './context/ThemeContext';
import './pages/hr/hr-ui.css';
import { LanguageProvider } from './context/LanguageContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { getUserRoleNames } from './utils/authz';
import {
    ADMIN,
    PLATFORM_ADMIN,
    OPS,
    CASHIER,
    WAITER_TABLE,
    KITCHEN_ROLES,
    HOST_ROLES,
    WAREHOUSE,
    CHEF_MGMT,
    HR_OWNER,
} from './constants/roles';

/** Route guard: redirects to /dashboard if none of the user's roles are in the allowed list */
function RoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
    const { user } = useAuth();
    if (!user) return <Navigate to="/dashboard" replace />;
    const userRoleNames = getUserRoleNames(user);
    const hasAccess = userRoleNames.some(rn => roles.includes(rn));
    if (!hasAccess) return <Navigate to="/dashboard" replace />;
    return <>{children}</>;
}

/** Self-service is only meaningful for users with a persisted employee profile. */
function InternalEmployeeGuard({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    if (!user || user.accountType !== 'INTERNAL' || !user.employeeId) {
        return <Navigate to="/dashboard" replace />;
    }
    return <>{children}</>;
}

// Lazy-loaded pages (code-split per route)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Tables = lazy(() => import('./pages/Tables'));
const Kitchen = lazy(() => import('./pages/Kitchen'));
const Users = lazy(() => import('./pages/Users'));
const Menu = lazy(() => import('./pages/Menu'));
const Orders = lazy(() => import('./pages/Orders'));
const Inventory = lazy(() => import('./pages/Inventory'));
const UnitsOfMeasure = lazy(() => import('./pages/UnitsOfMeasure'));
const ProductUnitSettings = lazy(() => import('./pages/ProductUnitSettings'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const PurchaseOrderForm = lazy(() => import('./pages/PurchaseOrderForm'));
const ProductionRecipes = lazy(() => import('./pages/ProductionRecipes'));
const ProductionOrders = lazy(() => import('./pages/ProductionOrders'));
const ProductionDashboard = lazy(() => import('./pages/ProductionDashboard'));
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
const Brands = lazy(() => import('./pages/Brands'));
const Promotions = lazy(() => import('./pages/Promotions'));
const WarehousesPage = lazy(() => import('./pages/Warehouses'));
const CostReport = lazy(() => import('./pages/CostReport'));
const Reports = lazy(() => import('./pages/Reports'));
const PedidosYaIntegration = lazy(() => import('./pages/PedidosYaIntegration'));
const Profile = lazy(() => import('./pages/Profile'));
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const HrDashboard = lazy(() => import('./pages/hr/HrDashboard'));
const Employees = lazy(() => import('./pages/hr/Employees'));
const EmployeeDetail = lazy(() => import('./pages/hr/EmployeeDetail'));
const MyHrLanding = lazy(() => import('./pages/hr/MyHrLanding'));
const Schedules = lazy(() => import('./pages/hr/Schedules'));
const MySchedule = lazy(() => import('./pages/hr/MySchedule'));
const TimeClock = lazy(() => import('./pages/hr/TimeClock'));
const Biometrics = lazy(() => import('./pages/hr/Biometrics'));
const AttendanceReview = lazy(() => import('./pages/hr/AttendanceReview'));
const AttendanceSettings = lazy(() => import('./pages/hr/AttendanceSettings'));
const AttendanceManagement = lazy(() => import('./pages/hr/AttendanceManagement'));
const LeaveManagement = lazy(() => import('./pages/hr/LeaveManagement'));
const MyWorkforce = lazy(() => import('./pages/hr/MyWorkforce'));
const PayrollManagement = lazy(() => import('./pages/hr/PayrollManagement'));
const MyPayroll = lazy(() => import('./pages/hr/MyPayroll'));
const BenefitsManagement = lazy(() => import('./pages/hr/BenefitsManagement'));
const MyBenefits = lazy(() => import('./pages/hr/MyBenefits'));
const NotFound = lazy(() => import('./pages/NotFound'));

function App() {
    return (
        <ErrorBoundary>
        <ThemeProvider>
            <LanguageProvider>
                <AuthProvider>
                    <CurrencyProvider>
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
                                <Route path="/rh/mi-portal" element={<InternalEmployeeGuard><MyHrLanding /></InternalEmployeeGuard>} />
                                <Route path="/rh/mi-portal/horario" element={<InternalEmployeeGuard><MySchedule /></InternalEmployeeGuard>} />
                                <Route path="/rh/marcaje" element={<InternalEmployeeGuard><TimeClock /></InternalEmployeeGuard>} />
                                <Route path="/rh/biometria" element={<InternalEmployeeGuard><Biometrics /></InternalEmployeeGuard>} />
                                <Route path="/rh/mi-portal/biometria" element={<Navigate to="/rh/biometria" replace />} />
                                <Route path="/rh/mi-portal/gestion" element={<InternalEmployeeGuard><MyWorkforce /></InternalEmployeeGuard>} />
                                <Route path="/rh/mi-portal/nomina" element={<InternalEmployeeGuard><MyPayroll /></InternalEmployeeGuard>} />
                                <Route path="/rh/mi-portal/prestaciones" element={<InternalEmployeeGuard><MyBenefits /></InternalEmployeeGuard>} />
                                <Route path="/manual" element={<Navigate to="/manual-usuario.html" replace />} />

                                {/* Human Resources – Owner administration + authenticated self-service */}
                                <Route path="/rh" element={<RoleGuard roles={HR_OWNER}><HrDashboard /></RoleGuard>} />
                                <Route path="/rh/personal" element={<RoleGuard roles={HR_OWNER}><Employees /></RoleGuard>} />
                                <Route path="/rh/personal/:employeeId" element={<RoleGuard roles={HR_OWNER}><EmployeeDetail /></RoleGuard>} />
                                <Route path="/rh/horarios" element={<RoleGuard roles={HR_OWNER}><Schedules /></RoleGuard>} />
                                <Route path="/rh/asistencia" element={<RoleGuard roles={HR_OWNER}><AttendanceReview /></RoleGuard>} />
                                <Route path="/rh/asistencia/configuracion" element={<RoleGuard roles={HR_OWNER}><AttendanceSettings /></RoleGuard>} />
                                <Route path="/rh/jornadas" element={<RoleGuard roles={HR_OWNER}><AttendanceManagement /></RoleGuard>} />
                                <Route path="/rh/ausencias" element={<RoleGuard roles={HR_OWNER}><LeaveManagement /></RoleGuard>} />
                                <Route path="/rh/nomina" element={<RoleGuard roles={HR_OWNER}><PayrollManagement /></RoleGuard>} />
                                <Route path="/rh/prestaciones" element={<RoleGuard roles={HR_OWNER}><BenefitsManagement /></RoleGuard>} />

                                {/* Operations – role-restricted */}
                                <Route path="/pos" element={<Navigate to="/tables" replace />} />
                                <Route path="/tables" element={<RoleGuard roles={WAITER_TABLE}><Tables /></RoleGuard>} />
                                <Route path="/kitchen" element={<RoleGuard roles={KITCHEN_ROLES}><Kitchen /></RoleGuard>} />
                                <Route path="/kds" element={<RoleGuard roles={KITCHEN_ROLES}><Kitchen displayMode /></RoleGuard>} />
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
                                <Route path="/menu-brands" element={<RoleGuard roles={CHEF_MGMT}><Brands /></RoleGuard>} />
                                <Route path="/promotions" element={<RoleGuard roles={ADMIN}><Promotions /></RoleGuard>} />
                                <Route path="/inventory" element={<RoleGuard roles={WAREHOUSE}><Inventory /></RoleGuard>} />
                                <Route path="/production-dashboard" element={<RoleGuard roles={WAREHOUSE}><ProductionDashboard /></RoleGuard>} />
                                <Route path="/production-recipes" element={<RoleGuard roles={WAREHOUSE}><ProductionRecipes /></RoleGuard>} />
                                <Route path="/production-orders" element={<RoleGuard roles={WAREHOUSE}><ProductionOrders /></RoleGuard>} />
                                <Route path="/units-of-measure" element={<RoleGuard roles={WAREHOUSE}><UnitsOfMeasure /></RoleGuard>} />
                                <Route path="/inventory/:productId/units" element={<RoleGuard roles={WAREHOUSE}><ProductUnitSettings /></RoleGuard>} />
                                <Route path="/kardex" element={<RoleGuard roles={WAREHOUSE}><Kardex /></RoleGuard>} />
                                <Route path="/suppliers" element={<RoleGuard roles={WAREHOUSE}><Suppliers /></RoleGuard>} />
                                <Route path="/purchase-orders" element={<RoleGuard roles={WAREHOUSE}><PurchaseOrders /></RoleGuard>} />
                                <Route path="/purchase-orders/new" element={<RoleGuard roles={WAREHOUSE}><PurchaseOrderForm /></RoleGuard>} />
                                <Route path="/purchase-orders/:id" element={<RoleGuard roles={WAREHOUSE}><PurchaseOrderForm /></RoleGuard>} />
                                <Route path="/warehouses" element={<RoleGuard roles={WAREHOUSE}><WarehousesPage /></RoleGuard>} />
                                <Route path="/cost-report" element={<RoleGuard roles={ADMIN}><CostReport /></RoleGuard>} />
                                <Route path="/reporteria" element={<RoleGuard roles={ADMIN}><Reports /></RoleGuard>} />
                                <Route path="/reporteria/:reportId" element={<RoleGuard roles={ADMIN}><Reports /></RoleGuard>} />
                                <Route path="/users" element={<RoleGuard roles={ADMIN}><Users /></RoleGuard>} />
                                <Route path="/waste-report" element={<RoleGuard roles={ADMIN}><WasteReport /></RoleGuard>} />
                                <Route path="/bank-reconciliation" element={<RoleGuard roles={ADMIN}><BankReconciliation /></RoleGuard>} />

                                {/* Configuration – admin/superadmin */}
                                <Route path="/branches" element={<RoleGuard roles={ADMIN}><Branches /></RoleGuard>} />
                                <Route path="/integraciones/pedidosya" element={<RoleGuard roles={ADMIN}><PedidosYaIntegration /></RoleGuard>} />
                                <Route path="/settings" element={<RoleGuard roles={ADMIN}><Settings /></RoleGuard>} />
                                <Route path="/roles-permissions" element={<RoleGuard roles={ADMIN}><RolesPermissions /></RoleGuard>} />
                                <Route path="/companies" element={<RoleGuard roles={PLATFORM_ADMIN}><Companies /></RoleGuard>} />
                            </Route>

                            <Route path="/" element={<Navigate to="/dashboard" replace />} />
                            <Route path="*" element={<NotFound />} />
                        </Routes>
                      </Suspense>
                    </BrowserRouter>
                    </CurrencyProvider>
                </AuthProvider>
            </LanguageProvider>
        </ThemeProvider>
        </ErrorBoundary>
    );
}

export default App;
