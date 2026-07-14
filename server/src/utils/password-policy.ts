import crypto from 'crypto';

/** Shared password policy for HTTP flows and trusted bootstrap scripts. */
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

export const BCRYPT_ROUNDS = 12;

/** bcrypt only considers the first 72 UTF-8 bytes. Reject longer inputs instead of
 * accepting two visibly different passwords that verify as the same secret. */
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

export const PASSWORD_POLICY_MESSAGE =
    'La contraseña debe tener mínimo 8 caracteres, incluyendo mayúscula, minúscula, número y símbolo, y no exceder 72 bytes UTF-8';

export function assertStrongPassword(password: string): void {
    if (!PASSWORD_REGEX.test(password) || Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_PASSWORD_BYTES) {
        throw new Error(PASSWORD_POLICY_MESSAGE);
    }
}

/** Generate a bootstrap secret that deterministically satisfies every policy class. */
export function generateStrongRandomPassword(length: number = 24): string {
    if (!Number.isInteger(length) || length < 12) {
        throw new Error('La longitud de la contraseña generada debe ser al menos 12');
    }

    const classes = [
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'abcdefghijklmnopqrstuvwxyz',
        '0123456789',
        '!@#$%^&*_-+=?'
    ];
    const alphabet = classes.join('');
    const characters = classes.map((group) => group[crypto.randomInt(group.length)]);
    while (characters.length < length) {
        characters.push(alphabet[crypto.randomInt(alphabet.length)]);
    }
    for (let index = characters.length - 1; index > 0; index -= 1) {
        const swapIndex = crypto.randomInt(index + 1);
        [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
    }
    return characters.join('');
}
