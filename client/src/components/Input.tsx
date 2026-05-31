import { InputHTMLAttributes, useId } from 'react';
import './Input.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    variant?: 'standard' | 'modal';
}

export default function Input({ label, error, variant = 'standard', className = '', id: idProp, ...props }: InputProps) {
    const autoId = useId();
    const inputId = idProp ?? autoId;
    const errorId = error ? `${inputId}-error` : undefined;
    const combinedClassName = `input-group ${variant} ${className}`.trim();
    const inputClass = variant === 'modal'
        ? `modal-standard-input ${error ? 'input-error' : ''}`
        : `input ${error ? 'input-error' : ''}`;

    return (
        <div className={combinedClassName}>
            {label && (
                <label className={variant === 'modal' ? 'modal-input-label' : 'input-label'} htmlFor={inputId}>
                    {label}
                </label>
            )}
            <input
                id={inputId}
                className={inputClass}
                aria-invalid={error ? true : undefined}
                aria-describedby={errorId}
                {...props}
            />
            {error && (
                <span id={errorId} className="input-error-message" role="alert">
                    {error}
                </span>
            )}
        </div>
    );
}
