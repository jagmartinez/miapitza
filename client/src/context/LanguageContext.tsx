import React, { useState } from 'react';
import { translations, Language, TranslationKeys } from '../utils/translations';
import { LanguageContext } from './language-context';

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [language, setLanguageState] = useState<Language>(() => {
        const saved = localStorage.getItem('language');
        return (saved as Language) || 'es';
    });

    const setLanguage = (lang: Language) => {
        setLanguageState(lang);
        localStorage.setItem('language', lang);
    };

    const t = (key: TranslationKeys): string => {
        const keys = key.split('.');
        let result: unknown = translations[language];

        for (const k of keys) {
            if (result && typeof result === 'object' && k in result) {
                result = (result as Record<string, unknown>)[k];
            } else {
                return key;
            }
        }

        return typeof result === 'string' ? result : key;
    };

    return (
        <LanguageContext.Provider value={{ language, setLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
};
