import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import Button from '../components/Button';
import './Login.css';

/** Map backend error messages to Spanish */
function translateError(msg: string): string {
    const map: Record<string, string> = {
        'Invalid credentials': 'Usuario o contraseña incorrectos',
        'Login failed': 'Error al iniciar sesión. Intenta de nuevo.',
        'User account is inactive': 'Tu cuenta está desactivada. Contacta al administrador.',
        'JWT_SECRET environment variable is not configured': 'Error de configuración del servidor.',
    };
    return map[msg] || msg || 'Error al iniciar sesión';
}

export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [twoFactorCode, setTwoFactorCode] = useState('');
    const [needs2FA, setNeeds2FA] = useState(false);
    const [error, setError] = useState('');
    const [shaking, setShaking] = useState(false);
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await login(username, password, needs2FA ? twoFactorCode : undefined);
            if (result?.requires2FA) {
                setNeeds2FA(true);
                setLoading(false);
                return;
            }
            navigate('/dashboard');
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : String(err);
            const msg = translateError(raw);
            setError(msg);
            setShaking(true);
            setTimeout(() => setShaking(false), 500);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-box">
                <div className="login-header">
                    <h1>Restaurant System</h1>
                    <p>Sistema de Gestión Restaurante</p>
                </div>

                <form
                    onSubmit={handleSubmit}
                    className={`login-form ${shaking ? 'shake' : ''}`}
                >
                    {error && (
                        <div className="login-error">
                            <AlertCircle size={18} />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className={`form-group ${error ? 'has-error' : ''}`}>
                        <label htmlFor="username">Usuario</label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Ingresa tu usuario"
                            required
                            autoFocus
                        />
                    </div>

                    <div className={`form-group ${error ? 'has-error' : ''}`}>
                        <label htmlFor="password">Contraseña</label>
                        <div className="password-input-wrap">
                            <input
                                id="password"
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Ingresa tu contraseña"
                                required
                            />
                            <button
                                type="button"
                                className="password-toggle"
                                onClick={() => setShowPassword(!showPassword)}
                                tabIndex={-1}
                                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    {needs2FA && (
                        <div className="form-group">
                            <label htmlFor="twoFactorCode">Código de Verificación (2FA)</label>
                            <input
                                id="twoFactorCode"
                                type="text"
                                maxLength={6}
                                value={twoFactorCode}
                                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                                placeholder="000000"
                                required
                                autoFocus
                                style={{ textAlign: 'center', fontSize: '20px', letterSpacing: '4px', fontFamily: 'monospace' }}
                            />
                        </div>
                    )}

                    <Button
                        type="submit"
                        variant="primary"
                        fullWidth
                        disabled={loading || (needs2FA && twoFactorCode.length !== 6)}
                    >
                        {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
                    </Button>

                    {import.meta.env.DEV && (
                        <div className="login-hint">
                            <small>Modo desarrollo</small>
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
}
