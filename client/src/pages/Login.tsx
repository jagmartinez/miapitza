import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AlertCircle,
    ArrowRight,
    Check,
    Eye,
    EyeOff,
    Loader2,
    LockKeyhole,
    ShieldCheck,
    Sparkles,
    UserRound,
    UtensilsCrossed,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import './Login.css';

/** Map backend error messages to Spanish */
function translateError(msg: string): string {
    const map: Record<string, string> = {
        'Invalid credentials': 'Usuario o contraseña incorrectos',
        'Credenciales inválidas': 'Usuario o contraseña incorrectos',
        'Código 2FA inválido': 'Código de verificación incorrecto',
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
        <main className="login-page">
            <div className="login-page__glow login-page__glow--top" aria-hidden="true" />
            <div className="login-page__glow login-page__glow--bottom" aria-hidden="true" />

            <div className="login-shell">
                <section className="login-showcase" aria-label="Restaurant System">
                    <div className="login-brand">
                        <span className="login-brand__mark" aria-hidden="true">
                            <UtensilsCrossed size={24} strokeWidth={2.2} />
                        </span>
                        <div>
                            <strong>Restaurant System</strong>
                            <span>Gestión inteligente</span>
                        </div>
                    </div>

                    <div className="login-showcase__content">
                        <span className="login-eyebrow">
                            <Sparkles size={14} aria-hidden="true" />
                            Todo tu restaurante, en un solo lugar
                        </span>
                        <h1>Opera con claridad.<br />Crece con control.</h1>
                        <p>
                            Centraliza ventas, mesas, cocina e inventario en una plataforma
                            diseñada para que tu equipo avance al mismo ritmo.
                        </p>

                        <ul className="login-benefits" aria-label="Beneficios de la plataforma">
                            <li><span><Check size={15} /></span>Operación conectada en tiempo real</li>
                            <li><span><Check size={15} /></span>Información segura y centralizada</li>
                            <li><span><Check size={15} /></span>Decisiones basadas en datos</li>
                        </ul>
                    </div>

                    <div className="login-showcase__footer">
                        <ShieldCheck size={18} aria-hidden="true" />
                        <span>Acceso protegido para tu equipo</span>
                    </div>
                </section>

                <section className="login-access" aria-labelledby="login-title">
                    <div className="login-mobile-brand" aria-hidden="true">
                        <span className="login-brand__mark">
                            <UtensilsCrossed size={21} strokeWidth={2.2} />
                        </span>
                        <strong>Restaurant System</strong>
                    </div>

                    <div className="login-card">
                        <div className="login-header">
                            <span className="login-header__icon" aria-hidden="true">
                                <LockKeyhole size={21} />
                            </span>
                            <div>
                                <span className="login-header__kicker">Acceso seguro</span>
                                <h2 id="login-title">Bienvenido de nuevo</h2>
                                <p>
                                    {needs2FA
                                        ? 'Ingresa el código de seguridad para completar el acceso.'
                                        : 'Ingresa tus credenciales para continuar.'}
                                </p>
                            </div>
                        </div>

                        <form
                            onSubmit={handleSubmit}
                            className={`login-form ${shaking ? 'shake' : ''}`}
                            aria-busy={loading}
                        >
                            {error && (
                                <div className="login-error" id="login-error" role="alert" aria-live="assertive">
                                    <AlertCircle size={18} aria-hidden="true" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className={`login-field ${error ? 'has-error' : ''}`}>
                                <label htmlFor="username">Usuario</label>
                                <div className="login-input-wrap">
                                    <UserRound size={18} aria-hidden="true" />
                                    <input
                                        id="username"
                                        name="username"
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        placeholder="Ingresa tu usuario"
                                        required
                                        autoFocus
                                        autoComplete="username"
                                        spellCheck={false}
                                        aria-invalid={Boolean(error)}
                                        aria-describedby={error ? 'login-error' : undefined}
                                    />
                                </div>
                            </div>

                            <div className={`login-field ${error ? 'has-error' : ''}`}>
                                <label htmlFor="password">Contraseña</label>
                                <div className="login-input-wrap login-input-wrap--password">
                                    <LockKeyhole size={18} aria-hidden="true" />
                                    <input
                                        id="password"
                                        name="password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Ingresa tu contraseña"
                                        required
                                        autoComplete="current-password"
                                        aria-invalid={Boolean(error)}
                                        aria-describedby={error ? 'login-error' : undefined}
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle"
                                        onClick={() => setShowPassword((visible) => !visible)}
                                        aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                        aria-pressed={showPassword}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            {needs2FA && (
                                <div className="login-field login-field--2fa">
                                    <div className="login-field__heading">
                                        <label htmlFor="twoFactorCode">Código de verificación</label>
                                        <span>6 dígitos</span>
                                    </div>
                                    <div className="login-input-wrap">
                                        <ShieldCheck size={18} aria-hidden="true" />
                                        <input
                                            id="twoFactorCode"
                                            name="twoFactorCode"
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            maxLength={6}
                                            value={twoFactorCode}
                                            onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                                            placeholder="000000"
                                            required
                                            autoFocus
                                            autoComplete="one-time-code"
                                            aria-label="Código de verificación de 6 dígitos"
                                        />
                                    </div>
                                </div>
                            )}

                            <button
                                type="submit"
                                className="login-submit"
                                disabled={loading || (needs2FA && twoFactorCode.length !== 6)}
                            >
                                <span>{loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}</span>
                                {loading
                                    ? <Loader2 className="login-submit__spinner" size={19} aria-hidden="true" />
                                    : <ArrowRight size={19} aria-hidden="true" />}
                            </button>

                            {import.meta.env.DEV && (
                                <div className="login-hint">
                                    <span aria-hidden="true" />
                                    Modo desarrollo
                                </div>
                            )}
                        </form>

                        <p className="login-card__support">
                            ¿Problemas para acceder? Contacta al administrador de tu cuenta.
                        </p>
                    </div>
                </section>
            </div>
        </main>
    );
}
