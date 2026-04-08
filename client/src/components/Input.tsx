import { InputHTMLAttributes } from 'react';
import './Input.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    variant?: 'standard' | 'modal';
}

export default function Input({ label, error, variant = 'standard', className = '', ...props }: InputProps) {
    const combinedClassName = `input-group ${variant} ${className}`;

    return (
        <div className={combinedClassName}>
            {label && <label className="input-label">{label}</label>}
            <input
                className={`input ${error ? 'input-error' : ''}`}
                {...props}
            />
            {error && <span className="input-error-message">{error}</span>}
        </div>
    );
}
