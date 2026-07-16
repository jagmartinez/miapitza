import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const login = read('./Login.tsx');
const loginCss = read('./Login.css');
const profile = read('./Profile.tsx');

describe('identity surfaces UX contract', () => {
    it('keeps authentication, 2FA, errors and accessible controls intact', () => {
        expect(login).toContain('login(username, password, needs2FA ? twoFactorCode : undefined)');
        expect(login).toContain('result?.requires2FA');
        expect(login).toContain('role="alert"');
        expect(login).toContain('autoComplete="one-time-code"');
        expect(login).toContain("twoFactorCode.length !== 6");
        expect(login).toContain("navigate('/dashboard')");
    });

    it('aligns login depth, panel, border and radius with the authenticated shell palette', () => {
        expect(loginCss).toContain('--login-bg: #0f172a');
        expect(loginCss).toContain('--login-panel: #1e293b');
        expect(loginCss).toContain('--login-border: #334155');
        expect(loginCss).toContain('width: min(100%, 1700px)');
        expect(loginCss).toContain('@media (prefers-reduced-motion: reduce)');
    });

    it('models Profile as identity, company, security and HR access center', () => {
        expect(profile).toContain('Centro de cuenta');
        expect(profile).toContain('Seguridad de la cuenta');
        expect(profile).toContain('Administrar mi cuenta');
        expect(profile).toContain("user?.accountType === 'INTERNAL' && Boolean(user.employeeId)");
        expect(profile).toContain('Esta cuenta todavía no está vinculada a un empleado');
        expect(profile).toContain('Expediente laboral vinculado');
        expect(profile).toContain('aria-label="Secciones de mi perfil"');
        expect(profile).toContain('Promise.allSettled');
    });
});
