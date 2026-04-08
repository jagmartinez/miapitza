import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function PrivateRoute({ children }: { children: React.ReactNode }) {
    const { user, isLoading, mustChangePassword, passwordExpired } = useAuth();
    const location = useLocation();

    if (isLoading) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh'
            }}>
                <div>Cargando...</div>
            </div>
        );
    }

    if (!user) return <Navigate to="/login" replace />;

    // Force password change — allow only the change-password route
    if ((mustChangePassword || passwordExpired) && location.pathname !== '/change-password') {
        return <Navigate to="/change-password" replace />;
    }

    return <>{children}</>;
}
