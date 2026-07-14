import {
    assertStrongPassword,
    generateStrongRandomPassword,
    PASSWORD_REGEX
} from '../../utils/password-policy';

describe('password policy', () => {
    it('generates bootstrap passwords that always satisfy every required character class', () => {
        for (let index = 0; index < 100; index += 1) {
            const password = generateStrongRandomPassword();
            expect(password).toHaveLength(24);
            expect(PASSWORD_REGEX.test(password)).toBe(true);
            expect(() => assertStrongPassword(password)).not.toThrow();
        }
    });

    it('rejects generation lengths that are too short for bootstrap credentials', () => {
        expect(() => generateStrongRandomPassword(8)).toThrow(/al menos 12/);
    });

    it('rejects secrets longer than bcrypt can distinguish', () => {
        expect(() => assertStrongPassword(`Aa1!${'x'.repeat(69)}`)).toThrow(/72 bytes/);
        expect(() => assertStrongPassword(`Aa1!${'ñ'.repeat(35)}`)).toThrow(/72 bytes/);
    });
});
