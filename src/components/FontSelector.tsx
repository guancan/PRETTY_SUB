import React from 'react';
import { GOOGLE_FONTS } from '@/lib/fonts';
import { Type } from 'lucide-react';

interface FontSelectorProps {
    currentFont: string;
    onFontChange: (font: string) => void;
}

export default function FontSelector({ currentFont, onFontChange }: FontSelectorProps) {
    return (
        <div className="font-selector">
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--text-secondary)',
                marginBottom: 12,
                fontSize: '0.9rem',
                fontWeight: 500
            }}>
                <Type size={14} />
                <span>Font Family</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                {GOOGLE_FONTS.map((font) => (
                    <button
                        key={font.family}
                        onClick={() => onFontChange(font.family)}
                        className={`font-option ${currentFont === font.family ? 'active' : ''}`}
                        style={{
                            padding: '12px',
                            borderRadius: 8,
                            border: `1px solid ${currentFont === font.family ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)'}`,
                            background: currentFont === font.family ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255,255,255,0.05)',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.2s',
                            fontFamily: font.family, // Preview the font directly
                            fontSize: '1rem'
                        }}
                    >
                        <div style={{ fontWeight: 600 }}>{font.name}</div>
                        <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: 4, fontFamily: 'var(--font-sans)' }}>{font.category}</div>
                    </button>
                ))}
            </div>

            <style jsx>{`
        .font-option:hover {
          background: rgba(255,255,255,0.1) !important;
          transform: translateY(-1px);
        }
      `}</style>
        </div>
    );
}
