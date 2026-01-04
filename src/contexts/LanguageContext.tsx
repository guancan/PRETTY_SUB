'use client';

import React, { createContext, useContext, useState } from 'react';

export type Language = 'en' | 'zh';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LANGUAGE_STORAGE_KEY = 'pretty_sub_language';

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Initialize language from localStorage, fallback to browser language
  const getInitialLanguage = (): Language => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === 'zh' || stored === 'en') {
        return stored;
      }
      // Fallback to browser language
      return navigator.language.startsWith('zh') ? 'zh' : 'en';
    }
    return 'en'; // Server-side default
  };

  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    // Persist language preference
    if (typeof window !== 'undefined') {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    }
  };

  const t = (key: string, params?: Record<string, string | number>) => {
    const translations = language === 'zh'
      ? require('@/locales/zh.json')
      : require('@/locales/en.json');

    const keys = key.split('.');
    let value: any = translations;

    for (const k of keys) {
      value = value?.[k];
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
