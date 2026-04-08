import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { authAPI } from '../services/api';
import { Lock, Eye, EyeOff, Check, X, ShieldCheck } from 'lucide-react';
import './ChangePassword.css';

const RULES = [
    { id: 'length', label: 'Mínimo 8 caracteres', test: (p: string) => p.length >= 8 },
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
                    <div className="pwd-success">
                        <ShieldCheck size={64} />
                        <h2>Contraseña actualizada</h2>
                        <p>Serás redirigido al inicio de sesión...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="change-pwd-page">
            <div className="change-pwd-card">
                <div className="pwd-header">
                    <Lock size={32} />
                    <h2>Cambiar Contraseña</h2>
                    <p>Por seguridad, debes actualizar tu contraseña para continuar.</p>
                </div>

                <form onSubmit={handleSubmit} className="pwd-form">
                    {error && <div className="pwd-error">{error}</div>}

                    <div className="pwd-field">
                        <label>Contraseña actual</label>
                        <div className="pwd-input-wrap">
                            <input
                                type={showOld ? 'text' : 'password'}
                                value={oldPassword}
                                onChange={(e) => setOldPassword(e.target.value)}
                                placeholder="Ingresa tu contraseña actual"
                                autoFocus
                            />
                            <button type="button" className="pwd-toggle" onClick={() => setShowOld(!showOld)}>
                                {showOld ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    <div className="pwd-field">
                        <label>Nueva contraseña</label>
                        <div className="pwd-input-wrap">
                            <input
                                type={showNew ? 'text' : 'password'}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="Ingresa tu nueva contraseña"
                            />
                            <button type="button" className="pwd-toggle" onClick={() => setShowNew(!showNew)}>
                                {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    {/* Strength Rules */}
                    <div className="pwd-rules">
                        {RULES.map(rule => (
                            <div key={rule.id} className={`pwd-rule ${rule.test(newPassword) ? 'pass' : newPassword.length > 0 ? 'fail' : ''}`}>
                                {rule.test(newPassword) ? <Check size={14} /> : <X size={14} />}
                                <span>{rule.label}</span>
                            </div>
                        ))}
                    </div>

                    <div className="pwd-field">
                        <label>Confirmar nueva contraseña</label>
                        <div className="pwd-input-wrap">
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Repite tu nueva contraseña"
                            />
                        </div>
                        {confirmPassword.length > 0 && !passwordsMatch && (
                            <span className="pwd-mismatch">Las contraseñas no coinciden</span>
                        )}
                    </div>

                    <button type="submit" className="pwd-submit" disabled={!canSubmit}>
                        {saving ? 'Guardando...' : 'Cambiar Contraseña'}
                    </button>
                </form>
            </div>
        </div>
    );
}
