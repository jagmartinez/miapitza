import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { authAPI } from '../services/api';
import { Lock, Eye, EyeOff, Check, X, ShieldCheck } from 'lucide-react';
import { Button, EmptyState, Field, IconButton, Input } from '@/ui';
import './ChangePassword.css';

const RULES = [
    { id: 'length', label: 'Mínimo 8 caracteres', test: (p: string) => p.length >= 8 },
    { id: 'max', label: 'Máximo seguro de 72 bytes', test: (p: string) => new TextEncoder().encode(p).length <= 72 },
    { id: 'upper', label: 'Una letra mayúscula', test: (p: string) => /[A-Z]/.test(p) },
    { id: 'lower', label: 'Una letra minúscula', test: (p: string) => /[a-z]/.test(p) },
    { id: 'number', label: 'Un número', test: (p: string) => /\d/.test(p) },
    { id: 'symbol', label: 'Un símbolo (!@#$%...)', test: (p: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p) },
];

export default function ChangePassword() {
    const { logout } = useAuth();
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showOld, setShowOld] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);

    const allValid = RULES.every(r => r.test(newPassword));
    const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
    const canSubmit = oldPassword.length > 0 && allValid && passwordsMatch && !saving;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setError('');
        setSaving(true);

        try {
            await authAPI.changePassword(oldPassword, newPassword);
            setSuccess(true);
            setTimeout(() => {
                logout();
            }, 2500);
        } catch (err: unknown) {
            const apiMsg = typeof err === 'object' && err !== null && 'response' in err
                ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            setError(apiMsg || 'Error al cambiar contraseña');
        } finally {
            setSaving(false);
        }
    };

    if (success) {
        return (
            <div className="change-pwd-page">
                <div className="change-pwd-card">
                    <EmptyState
                        icon={ShieldCheck}
                        title="Contraseña actualizada"
                        description="Serás redirigido al inicio de sesión..."
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="change-pwd-page">
            <div className="change-pwd-card">
                <header className="pwd-header">
                    <Lock size={28} aria-hidden="true" />
                    <h1>Cambiar Contraseña</h1>
                    <p>Por seguridad, debes actualizar tu contraseña para continuar.</p>
                </header>

                <form onSubmit={handleSubmit} className="pwd-form">
                    {error && <div className="pwd-error" role="alert">{error}</div>}

                    <Field label="Contraseña actual" htmlFor="cp-old">
                        <Input
                            id="cp-old"
                            type={showOld ? 'text' : 'password'}
                            autoComplete="current-password"
                            value={oldPassword}
                            onChange={(e) => setOldPassword(e.target.value)}
                            placeholder="Ingresa tu contraseña actual"
                            autoFocus
                            suffix={
                                <IconButton
                                    icon={showOld ? EyeOff : Eye}
                                    label={showOld ? 'Ocultar contraseña actual' : 'Mostrar contraseña actual'}
                                    aria-pressed={showOld}
                                    onClick={() => setShowOld(!showOld)}
                                />
                            }
                        />
                    </Field>

                    <Field label="Nueva contraseña" htmlFor="cp-new">
                        <Input
                            id="cp-new"
                            type={showNew ? 'text' : 'password'}
                            autoComplete="new-password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            maxLength={72}
                            placeholder="Ingresa tu nueva contraseña"
                            suffix={
                                <IconButton
                                    icon={showNew ? EyeOff : Eye}
                                    label={showNew ? 'Ocultar nueva contraseña' : 'Mostrar nueva contraseña'}
                                    aria-pressed={showNew}
                                    onClick={() => setShowNew(!showNew)}
                                />
                            }
                        />
                    </Field>

                    <ul className="pwd-rules" aria-label="Requisitos de la contraseña">
                        {RULES.map(rule => (
                            <li key={rule.id} className={`pwd-rule ${rule.test(newPassword) ? 'pass' : newPassword.length > 0 ? 'fail' : ''}`}>
                                {rule.test(newPassword) ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                                <span>{rule.label}</span>
                            </li>
                        ))}
                    </ul>

                    <Field
                        label="Confirmar nueva contraseña"
                        htmlFor="cp-confirm"
                        error={confirmPassword.length > 0 && !passwordsMatch ? 'Las contraseñas no coinciden' : undefined}
                    >
                        <Input
                            id="cp-confirm"
                            type="password"
                            autoComplete="new-password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Repite tu nueva contraseña"
                        />
                    </Field>

                    <Button type="submit" variant="primary" disabled={!canSubmit} loading={saving}>
                        {saving ? 'Guardando...' : 'Cambiar Contraseña'}
                    </Button>
                </form>
            </div>
        </div>
    );
}
