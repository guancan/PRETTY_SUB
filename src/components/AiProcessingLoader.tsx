'use client';

import { useEffect, useState } from 'react';

interface AiProcessingLoaderProps {
  text?: string;
}

export default function AiProcessingLoader({ text = 'AI 处理中' }: AiProcessingLoaderProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % text.length);
    }, 100);

    return () => clearInterval(interval);
  }, [text.length]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
      {text.split('').map((char, index) => {
        // Create a gradient effect from darker to lighter blue
        const isActive = index === activeIndex;
        const distanceFromActive = (index - activeIndex + text.length) % text.length;
        const opacity = isActive ? 1 : Math.max(0.3, 1 - distanceFromActive * 0.2);
        const blueValue = Math.floor(255 - distanceFromActive * 40);
        const color = `rgba(59, 130, ${blueValue}, ${opacity})`;

        return (
          <span
            key={index}
            style={{
              fontSize: '1rem',
              fontWeight: 500,
              color,
              transition: 'color 0.2s ease',
              display: 'inline-block',
            }}
          >
            {char}
          </span>
        );
      })}
    </div>
  );
}
