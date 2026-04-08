import Select, { Props as SelectProps, GroupBase } from 'react-select';
import './Select.css';

interface CustomSelectProps<
    Option = { value: string | number; label: string },
    IsMulti extends boolean = false,
    Group extends GroupBase<Option> = GroupBase<Option>
> extends SelectProps<Option, IsMulti, Group> {
    label?: string;
    error?: string;
    variant?: 'standard' | 'modal';
}

export default function CustomSelect<
    Option = { value: string | number; label: string },
    IsMulti extends boolean = false,
    Group extends GroupBase<Option> = GroupBase<Option>
>({
    label,
    error,
    variant = 'standard',
    className = '',
    classNamePrefix = 'react-select',
    ...props
}: CustomSelectProps<Option, IsMulti, Group>) {
    const combinedClassName = `select-group ${variant} ${className}`;

    return (
        <div className={combinedClassName}>
            {label && <label className="select-label">{label}</label>}
            <Select
                classNamePrefix={classNamePrefix}
                {...props}
            />
            {error && <span className="select-error-message">{error}</span>}
        </div>
    );
}
