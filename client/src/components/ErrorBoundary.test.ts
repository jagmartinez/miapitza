import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_BOUNDARY_TITLE, ErrorBoundary } from './ErrorBoundary';
import { isErrorHandled } from '../services/notify';
import { CHUNK_LOAD_MESSAGE } from '../utils/apiError';

/**
 * Server rendering does not run error boundaries, so the lifecycle is driven
 * directly: derive state from an error, then render the fallback markup.
 */
function renderWithError(error: Error | null, props: Record<string, unknown> = {}) {
    const boundary = new ErrorBoundary({ children: createElement('p', null, 'contenido'), ...props });
    if (error) boundary.state = { ...boundary.state, ...ErrorBoundary.getDerivedStateFromError(error) };
    return { boundary, html: renderToStaticMarkup(boundary.render() as never) };
}

describe('ErrorBoundary', () => {
    afterEach(() => vi.restoreAllMocks());

    it('renders children while healthy', () => {
        expect(renderWithError(null).html).toBe('<p>contenido</p>');
    });

    it('shows a friendly, accessible fallback with Reintentar', () => {
        const { html } = renderWithError(new TypeError('x is undefined'));
        expect(html).toContain(ERROR_BOUNDARY_TITLE);
        expect(html).toContain('role="alert"');
        expect(html).toContain('Reintentar');
        expect(html).toContain('Recargar página');
        expect(html).not.toContain('x is undefined</p>');
    });

    it('asks to reload (no retry) when a lazy chunk failed to load', () => {
        const { html } = renderWithError(new TypeError('Failed to fetch dynamically imported module: /assets/Menu.js'));
        expect(html).toContain(CHUNK_LOAD_MESSAGE);
        expect(html).not.toContain('>Reintentar<');
    });

    it('Reintentar clears the error and resetKey changes reset it', () => {
        const { boundary } = renderWithError(new Error('falló'), { resetKey: '/a' });
        const setState = vi.spyOn(boundary, 'setState').mockImplementation(() => undefined);
        boundary.retry();
        expect(setState).toHaveBeenCalledWith({ error: null });

        const next = ErrorBoundary.getDerivedStateFromProps(
            { children: null, resetKey: '/b' },
            { error: new Error('falló'), resetKey: '/a' },
        );
        expect(next).toEqual({ resetKey: '/b', error: null });
        expect(ErrorBoundary.getDerivedStateFromProps({ children: null, resetKey: '/a' }, { error: null, resetKey: '/a' })).toBeNull();
    });

    it('marks caught errors as handled so global handlers do not toast them again', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const err = new Error('render roto');
        const boundary = new ErrorBoundary({ children: null });
        boundary.componentDidCatch(err, { componentStack: '' });
        expect(isErrorHandled(err)).toBe(true);
    });
});
