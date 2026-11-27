import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AlertCircle,
    ChefHat,
    Eye,
    EyeOff,
    LockKeyhole,
    ShieldCheck,
    UserRound,
    UtensilsCrossed,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button, Field, IconButton, Input } from '@/ui';
import './Login.css';

/** Traduce los mensajes del servidor a español claro. */
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
            setError(translateError(raw));
        } finally {
            setLoading(false);
        }
    };

    const describedBy = error ? 'login-error' : undefined;

    return (
        <main className="login">
            <section className="login__panel" aria-labelledby="login-title">
                <div className="login__brand">
                    <span className="login__mark" aria-hidden="true"><UtensilsCrossed size={20} /></span>
                    <span className="login__brand-name">Restaurant System</span>
                </div>

                <div className="login__body">
                    <header className="login__head">
                        <h1 id="login-title">{needs2FA ? 'Verificación en dos pasos' : 'Iniciar sesión'}</h1>
                        <p>
                            {needs2FA
                                ? 'Escribe el código de 6 dígitos de tu aplicación de autenticación.'
                                : 'Usa tu usuario y contraseña de la empresa.'}
                        </p>
                    </header>

                    <form onSubmit={handleSubmit} className="login__form" aria-busy={loading}>
                        {error && (
                            <div className="login__error" id="login-error" role="alert" aria-live="assertive">
                                <AlertCircle size={16} aria-hidden="true" />
                                <span>{error}</span>
                            </div>
                        )}

                        {!needs2FA && (
                            <>
                                <Field label="Usuario" htmlFor="username">
                                    <Input
                                        id="username"
                                        name="username"
                                        type="text"
                                        prefix={<UserRound size={16} aria-hidden="true" />}
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        placeholder="nombre.usuario"
                                        required
                                        autoFocus
                                        autoComplete="username"
                                        spellCheck={false}
                                        aria-invalid={Boolean(error)}
                                        aria-describedby={describedBy}
                                    />
                                </Field>

                                <Field label="Contraseña" htmlFor="password">
                                    <Input
                                        id="password"
                                        name="password"
                                        type={showPassword ? 'text' : 'password'}
                                        prefix={<LockKeyhole size={16} aria-hidden="true" />}
                                        suffix={
                                            <IconButton
                                                size="sm"
                                                icon={showPassword ? EyeOff : Eye}
                                                label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                                aria-pressed={showPassword}
                                                onClick={() => setShowPassword((v) => !v)}
                                            />
                                        }
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        required
                                        autoComplete="current-password"
                                        aria-invalid={Boolean(error)}
                                        aria-describedby={describedBy}
                                    />
                                </Field>
                            </>
                        )}

                        {needs2FA && (
                            <Field label="Código de verificación" htmlFor="twoFactorCode">
                                <Input
                                    id="twoFactorCode"
                                    name="twoFactorCode"
                                    type="text"
                                    className="login__otp"
                                    prefix={<ShieldCheck size={16} aria-hidden="true" />}
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={6}
                                    value={twoFactorCode}
                                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                                    placeholder="000000"
                                    required
                                    autoFocus
                                    autoComplete="one-time-code"
                                    aria-describedby={describedBy}
                                />
                            </Field>
                        )}

                        <Button
                            type="submit"
                            variant="primary"
                            size="lg"
                            className="login__submit"
                            loading={loading}
                            disabled={needs2FA && twoFactorCode.length !== 6}
                        >
                            {loading ? 'Verificando…' : needs2FA ? 'Verificar y entrar' : 'Entrar'}
                        </Button>

                        {needs2FA && (
                            <Button
                                variant="ghost"
                                className="login__link"
                                onClick={() => { setNeeds2FA(false); setTwoFactorCode(''); setError(''); }}
                            >
                                Usar otra cuenta
                            </Button>
                        )}
                    </form>
                </div>

                <footer className="login__foot">
                    <span>¿Problemas para entrar? Pide al administrador que revise tu cuenta.</span>
                    {import.meta.env.DEV && <span className="login__dev">Desarrollo</span>}
                </footer>
            </section>

            <aside className="login__aside" aria-hidden="true">
                <div className="login__aside-inner">
                    <ChefHat size={40} strokeWidth={1.5} className="login__aside-icon" />
                    <p className="login__quote">Ventas, cocina, inventario y personal en un solo lugar.</p>
                    <dl className="login__facts">
                        <div><dt>Salón y caja</dt><dd>Órdenes, cobros y cierres de turno</dd></div>
                        <div><dt>Cocina y producción</dt><dd>Recetas, costos y mermas</dd></div>
                        <div><dt>Personal</dt><dd>Horarios, asistencia y planilla</dd></div>
                    </dl>
                </div>
            </aside>
        </main>
    );
}
