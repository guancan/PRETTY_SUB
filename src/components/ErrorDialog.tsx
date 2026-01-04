import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface ErrorDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onClose: () => void;
}

export default function ErrorDialog({ isOpen, title, message, onClose }: ErrorDialogProps) {
  const { t } = useLanguage();

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel"
        style={{
          width: 'min(480px, 92vw)',
          padding: 24,
          background: 'rgba(20,20,20,0.92)',
          borderRadius: 'var(--radius-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              background: 'rgba(239, 68, 68, 0.15)',
              padding: 8,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <AlertCircle size={20} color="#ef4444" />
            </div>
            <h3 style={{ margin: 0 }}>{title}</h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <p style={{
          margin: 0,
          color: 'var(--text-secondary)',
          fontSize: '0.95rem',
          lineHeight: 1.6
        }}>
          {message}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
          <button
            onClick={onClose}
            className="btn-primary"
            style={{ padding: '8px 20px', fontSize: '0.9rem' }}
          >
            {t('dialogs.error.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
