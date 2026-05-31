import { ReactNode, useId } from 'react';

interface FormFieldProps {
    label: string;
    htmlFor?: string;
    required?: boolean;
    optional?: boolean;
    error?: string;
    children: (id: string) => ReactNode;
}

export function FormField({ label, required, optional, error, children }: FormFieldProps) {
    const id = useId();
    return (
        <div className="modal-input-group">
            <label className="modal-input-label" htmlFor={id}>
                {label}{required && ' *'}{optional && ' (opcional)'}
            </label>
            {children(id)}
            {error && <span className="input-error-message" role="alert">{error}</span>}
        </div>
    );
}
