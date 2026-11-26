import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const ROOT = path.resolve(__dirname, '../../../..');
const SOURCE_ROOTS = [
    'client/src',
    'client/tests',
    'server/src',
    'server/scripts',
    'server/prisma',
    'biometric-provider',
    'docs',
];
const TEXT_EXTENSIONS = new Set([
    '.css',
    '.js',
    '.jsx',
    '.md',
    '.prisma',
    '.py',
    '.sql',
    '.ts',
    '.tsx',
    '.yaml',
    '.yml',
]);
const IGNORED_DIRECTORIES = new Set([
    '.pytest_cache',
    '.venv',
    '__pycache__',
    'coverage',
    'dist',
    'node_modules',
    'playwright-report',
    'test-results',
]);

function collectTextFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        if (IGNORED_DIRECTORIES.has(entry.name)) return [];
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectTextFiles(absolutePath);
        return TEXT_EXTENSIONS.has(path.extname(entry.name)) ? [absolutePath] : [];
    });
}

describe('UTF-8 source contract', () => {
    it('does not ship common mojibake or replacement markers in runtime text and runbooks', () => {
        const affected = SOURCE_ROOTS.flatMap(relativeRoot => {
            const absoluteRoot = path.join(ROOT, relativeRoot);
            if (!fs.existsSync(absoluteRoot)) return [];
            return collectTextFiles(absoluteRoot);
        }).filter(file => /[\u00c3\u00c2\u00e2\u00f0\ufffd]/u.test(fs.readFileSync(file, 'utf8')))
            .map(file => path.relative(ROOT, file).split(path.sep).join('/'));

        expect(affected).toEqual([]);
    });
});
