import { describe, expect, it } from 'vitest';
import { profileCompleteness, resolveProfileTab } from './profileHelpers';

describe('profileHelpers', () => {
    it('los enlaces antiguos abren la pestaña que ahora contiene esa información', () => {
        expect(resolveProfileTab(null)).toBe('resumen');
        expect(resolveProfileTab('hr')).toBe('resumen');
        expect(resolveProfileTab('2fa')).toBe('seguridad');
        expect(resolveProfileTab('sessions')).toBe('seguridad');
        expect(resolveProfileTab('permissions')).toBe('seguridad');
        expect(resolveProfileTab('settings')).toBe('preferencias');
        expect(resolveProfileTab('notificaciones')).toBe('notificaciones');
        expect(resolveProfileTab('desconocida')).toBe('resumen');
    });

    it('la completitud cuenta solo datos reales y lista lo que falta', () => {
        const c = profileCompleteness({ name: 'Ana', email: 'a@x.com', nif: '', phone: '555', address: undefined }, false);
        expect(c.pct).toBe(50);
        expect(c.missing).toEqual(['cédula', 'dirección', 'expediente laboral']);
        // Cuenta externa: el expediente no aplica y no penaliza.
        expect(profileCompleteness({ name: 'A', email: 'b', nif: 'c', phone: 'd', address: 'e' }, null).pct).toBe(100);
    });
});
