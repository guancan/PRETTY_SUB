'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { Languages } from 'lucide-react';

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <button
      onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 16px',
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        fontSize: '0.9rem',
        color: 'var(--text-primary)',
        transition: 'all 0.2s'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-highlight)';
        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
      }}
    >
      <Languages size={16} />
      {t('language.switchTo')}
    </button>
  );
}
