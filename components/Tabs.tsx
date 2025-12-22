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
      <div className="tabs mb-4">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            className={clsx('tab', { 'tab-active': active === i })}
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="card-body">{tabs[active]?.content}</div>
      </div>
    </div>
  );
}
