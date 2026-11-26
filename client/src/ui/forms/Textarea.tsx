import { forwardRef, type TextareaHTMLAttributes } from 'react';
import './forms.css';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className = '', rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`ui-textarea ${rest['aria-invalid'] ? 'ui-textarea--invalid' : ''} ${className}`.trim()}
      {...rest}
    />
  );
});
