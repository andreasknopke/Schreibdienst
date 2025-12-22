"use client";
import { clsx } from 'clsx';

export default function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  const style: React.CSSProperties = { width: size, height: size };
  return (
    <span
      style={style}
      className={clsx(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-[-0.125em]',
        className
      )}
      aria-label="Lädt"
      role="status"
    />
  );
}
