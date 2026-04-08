import { Globe, ChevronDown, Check } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import { useState, useRef, useEffect } from 'react';

export default function LanguageSelector() {
    const { language, setLanguage } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const languages = [
        { code: 'es', label: 'ES' },
        { code: 'en', label: 'EN' }
    ];

    const handleSelect = (code: 'es' | 'en') => {
        setLanguage(code);
        setIsOpen(false);
    };

    return (
        <div className="language-selector-wrapper" ref={containerRef}>
            <button
                className={`language-selector ${isOpen ? 'active' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                title="Cambiar idioma"
            >
                <Globe size={16} />
                <span className="current-lang">{language.toUpperCase()}</span>
                <ChevronDown size={12} className={`lang-chevron ${isOpen ? 'rotate' : ''}`} />
            </button>

            {isOpen && (
                <div className="lang-dropdown">
                    {languages.map((lang) => (
                        <button
                            key={lang.code}
                            className={`lang-option ${language === lang.code ? 'selected' : ''}`}
                            onClick={() => handleSelect(lang.code as 'es' | 'en')}
                        >
                            <span>{lang.label}</span>
                            {language === lang.code && <Check size={14} />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
