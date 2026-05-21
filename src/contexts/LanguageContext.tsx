'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import zhTranslations from '@/locales/zh.json';
import enTranslations from '@/locales/en.json';

export type Language = 'en' | 'zh';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LANGUAGE_STORAGE_KEY = 'pretty_sub_language';

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const getPreferredLanguage = (): Language => {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === 'zh' || stored === 'en') return stored;
  return navigator.language.startsWith('zh') ? 'zh' : 'en';
};

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Always start with 'en' to match SSR, then update on client after mount
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    // Read persisted preference or browser language only on the client
    const timeoutId = window.setTimeout(() => {
      setLanguageState(getPreferredLanguage());
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    // Persist language preference
    if (typeof window !== 'undefined') {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    }
  };

  const t = (key: string, params?: Record<string, string | number>) => {
    const translations = language === 'zh' ? zhTranslations : enTranslations;

    const keys = key.split('.');
    let value: unknown = translations;

    for (const k of keys) {
      value = typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[k]
        : undefined;
    }

    if (typeof value !== 'string') {
      return key;
    }

    if (params) {
      return value.replace(/\{(\w+)\}/g, (match, param) => {
        return String(params[param] ?? match);
      });
    }

    return value;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
