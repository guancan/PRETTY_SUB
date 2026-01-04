import React, { useEffect, useState } from 'react';
import { SegmentationOptions, DEFAULT_SEGMENTATION_OPTIONS } from '@/lib/segmentation';
import { X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface SegmentationRulesModalProps {
  isOpen: boolean;
  options: SegmentationOptions;
  onClose: () => void;
  onSave: (next: SegmentationOptions) => void;
}

const numberInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
  fontSize: '0.95rem',
  fontFamily: 'inherit',
};

export default function SegmentationRulesModal({ isOpen, options, onClose, onSave }: SegmentationRulesModalProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<SegmentationOptions>(DEFAULT_SEGMENTATION_OPTIONS);

  useEffect(() => {
    if (isOpen) {
      setDraft({
        ...DEFAULT_SEGMENTATION_OPTIONS,
        ...options,
      });
    }
  }, [isOpen, options]);

  if (!isOpen) return null;

  const updateNumber = (key: keyof SegmentationOptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (Number.isNaN(value)) return;
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave({
      maxCharsPerLine: Math.max(1, draft.maxCharsPerLine ?? DEFAULT_SEGMENTATION_OPTIONS.maxCharsPerLine),
      maxDurationSeconds: Math.max(0.1, draft.maxDurationSeconds ?? DEFAULT_SEGMENTATION_OPTIONS.maxDurationSeconds),
      punctuationSplit: draft.punctuationSplit ?? DEFAULT_SEGMENTATION_OPTIONS.punctuationSplit,
      punctuationMinChars: Math.max(1, draft.punctuationMinChars ?? DEFAULT_SEGMENTATION_OPTIONS.punctuationMinChars),
    });
    onClose();
  };

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
          width: 'min(640px, 92vw)',
          padding: 24,
          background: 'rgba(20,20,20,0.92)',
          borderRadius: 'var(--radius-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>{t('segmentation.modal.title')}</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>{t('segmentation.modal.maxCharsLabel')}</label>
            <input
              type="number"
              min={5}
              max={80}
              step={1}
              value={draft.maxCharsPerLine ?? ''}
              onChange={updateNumber('maxCharsPerLine')}
              style={numberInputStyle}
            />
            <div style={{ marginTop: 6, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              {t('segmentation.modal.maxCharsHelp')}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>{t('segmentation.modal.maxDurationLabel')}</label>
            <input
              type="number"
              min={0.5}
              max={10}
              step={0.1}
              value={draft.maxDurationSeconds ?? ''}
              onChange={updateNumber('maxDurationSeconds')}
              style={numberInputStyle}
            />
            <div style={{ marginTop: 6, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              {t('segmentation.modal.maxDurationHelp')}
            </div>
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={draft.punctuationSplit ?? DEFAULT_SEGMENTATION_OPTIONS.punctuationSplit}
                onChange={(e) => setDraft((prev) => ({ ...prev, punctuationSplit: e.target.checked }))}
              />
              {t('segmentation.modal.punctuationSplitLabel')}
            </label>
            <div style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              {t('segmentation.modal.punctuationSplitHelp')}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>{t('segmentation.modal.punctuationMinCharsLabel')}</label>
            <input
              type="number"
              min={5}
              max={40}
              step={1}
              value={draft.punctuationMinChars ?? ''}
              onChange={updateNumber('punctuationMinChars')}
              style={{
                ...numberInputStyle,
                opacity: draft.punctuationSplit === false ? 0.5 : 1,
              }}
              disabled={draft.punctuationSplit === false}
            />
            <div style={{ marginTop: 6, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              {t('segmentation.modal.punctuationMinCharsHelp')}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              padding: '8px 14px',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            {t('segmentation.modal.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="btn-primary"
            style={{ padding: '8px 16px', fontSize: '0.9rem' }}
          >
            {t('segmentation.modal.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
