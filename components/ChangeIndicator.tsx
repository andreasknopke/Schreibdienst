'use client';

import { useMemo } from 'react';

interface ChangeIndicatorProps {
  score: number | null | undefined;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Ampel-Komponente zur Visualisierung des LLM-Änderungsgrads
 * 
 * Grün (0-15%): Minimale Änderungen
 * Gelb (16-35%): Moderate Änderungen
 * Rot (36-100%): Signifikante Änderungen
 */
export function ChangeIndicator({ score, showLabel = true, size = 'md' }: ChangeIndicatorProps) {
  const { color, bgColor, label, icon } = useMemo(() => {
    if (score === null || score === undefined) {
      return {
        color: 'text-gray-400',
        bgColor: 'bg-gray-100 dark:bg-gray-700',
        label: 'Keine Daten',
        icon: '○'
      };
    }
    
    if (score <= 15) {
      return {
        color: 'text-green-600 dark:text-green-400',
        bgColor: 'bg-green-100 dark:bg-green-900/30',
        label: score <= 5 ? 'Kaum Änderungen' : 'Minimale Korrekturen',
        icon: '●'
      };
    }
    
    if (score <= 35) {
      return {
        color: 'text-yellow-600 dark:text-yellow-400',
        bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
        label: score <= 25 ? 'Leichte Anpassungen' : 'Moderate Korrekturen',
        icon: '●'
      };
    }
    
    return {
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-100 dark:bg-red-900/30',
      label: score <= 50 ? 'Deutliche Änderungen' : score <= 70 ? 'Starke Überarbeitung' : 'Umfangreiche Änderungen',
      icon: '⚠'
    };
  }, [score]);
  
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5'
  };
  
  const iconSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base'
  };

  if (score === null || score === undefined) {
    return null;
  }

  return (
    <div 
      className={`inline-flex items-center gap-1.5 rounded-full ${bgColor} ${sizeClasses[size]}`}
      title={`Änderungsgrad: ${score}% - ${label}`}
    >
      <span className={`${iconSizeClasses[size]} ${color}`}>{icon}</span>
      {showLabel && (
        <span className={`${color} font-medium`}>
          {score}%
        </span>
      )}
    </div>
  );
}

/**
 * Kompakte Ampel-Anzeige nur mit Punkt
 */
export function ChangeIndicatorDot({ score }: { score: number | null | undefined }) {
  const color = useMemo(() => {
    if (score === null || score === undefined) return 'bg-gray-300 dark:bg-gray-600';
    if (score <= 15) return 'bg-green-500';
    if (score <= 35) return 'bg-yellow-500';
    return 'bg-red-500';
  }, [score]);
  
  const label = useMemo(() => {
    if (score === null || score === undefined) return 'Keine Daten';
    if (score <= 15) return `${score}% - Minimale Änderungen`;
    if (score <= 35) return `${score}% - Moderate Änderungen`;
    return `${score}% - Signifikante Änderungen`;
  }, [score]);

  return (
    <span 
      className={`inline-block w-2.5 h-2.5 rounded-full ${color}`}
      title={label}
    />
  );
}

/**
 * Banner für signifikante Änderungen
 */
export function ChangeWarningBanner({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined || score <= 35) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
      <span className="text-lg">⚠️</span>
      <span>
        <strong>Hinweis:</strong> Das LLM hat {score}% des Textes verändert. 
        Bitte prüfen Sie die Korrektur sorgfältig.
      </span>
    </div>
  );
}
