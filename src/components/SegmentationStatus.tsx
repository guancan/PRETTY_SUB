'use client';

import { CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

export type SegmentationStatus =
  | 'idle'
  | 'ai-started'
  | 'ai-processing'
  | 'ai-success'
  | 'ai-failed'
  | 'rules-processing'
  | 'rules-success';

interface SegmentationStatusBadgeProps {
  status: SegmentationStatus;
  aiModel?: string;
}

const statusConfig = {
  'ai-started': {
    icon: Sparkles,
    text: '启动 AI 分段',
    bg: 'rgba(59, 130, 246, 0.1)',
    border: 'rgba(59, 130, 246, 0.3)',
    color: '#60a5fa',
  },
  'ai-processing': {
    icon: Loader2,
    text: 'AI 处理中...',
    bg: 'rgba(59, 130, 246, 0.1)',
    border: 'rgba(59, 130, 246, 0.3)',
    color: '#60a5fa',
    spin: true,
  },
  'ai-success': {
    icon: CheckCircle2,
    text: (model?: string) => `AI 分段成功${model ? ` (${model})` : ''}`,
    bg: 'rgba(34, 197, 94, 0.1)',
    border: 'rgba(34, 197, 94, 0.3)',
    color: '#4ade80',
  },
  'ai-failed': {
    icon: AlertCircle,
    text: 'AI 失败，切换规则分段',
    bg: 'rgba(251, 146, 60, 0.1)',
    border: 'rgba(251, 146, 60, 0.3)',
    color: '#fb923c',
  },
  'rules-processing': {
    icon: Loader2,
    text: '规则分段处理中...',
    bg: 'rgba(168, 85, 247, 0.1)',
    border: 'rgba(168, 85, 247, 0.3)',
    color: '#c084fc',
    spin: true,
  },
  'rules-success': {
    icon: CheckCircle2,
    text: '规则分段完成',
    bg: 'rgba(34, 197, 94, 0.1)',
    border: 'rgba(34, 197, 94, 0.3)',
    color: '#4ade80',
  },
};

const SpinningIcon = ({ icon: Icon, size }: { icon: any; size: number }) => (
  <motion.div
    animate={{ rotate: 360 }}
    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
  >
    <Icon size={size} />
  </motion.div>
);

export function SegmentationStatusBadge({ status, aiModel }: SegmentationStatusBadgeProps) {
  if (status === 'idle') return null;

  const config = statusConfig[status];
  const Icon = config.icon;
  const text = typeof config.text === 'function' ? config.text(aiModel) : config.text;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '8px',
        fontSize: '0.8rem',
        background: config.bg,
        border: `1px solid ${config.border}`,
        color: config.color,
        fontWeight: 500,
      }}
    >
      {config.spin ? (
        <SpinningIcon icon={Icon} size={14} />
      ) : (
        <Icon size={14} />
      )}
      <span>{text}</span>
    </motion.div>
  );
}
