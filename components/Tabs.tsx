"use client";
import { useState } from 'react';
import { clsx } from 'clsx';

export function Tabs({
  tabs,
  initial = 0,
}: {
  tabs: { label: string; content: React.ReactNode }[];
  initial?: number;
}) {
  const [active, setActive] = useState(initial);
  return (
    <div>
      <div className="flex gap-2 border-b mb-4">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            className={clsx(
              'px-3 py-2 text-sm border-b-2 -mb-px',
              active === i ? 'border-black' : 'border-transparent text-gray-500'
            )}
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{tabs[active]?.content}</div>
    </div>
  );
}
