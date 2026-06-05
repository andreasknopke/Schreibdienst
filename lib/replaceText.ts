import { applyDictionaryReplacementCase } from './replacementCase';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceAllInText(content: string, wrong: string, correct: string): string {
  if (!content || !wrong || !correct) return content;

  const trimmedWrong = wrong.trim();
  const trimmedCorrect = correct.trim();

  if (!trimmedWrong || !trimmedCorrect) return content;

  const pattern = new RegExp(`\\b${escapeRegExp(trimmedWrong)}\\b`, 'gi');

  return content.replace(pattern, (match) => applyDictionaryReplacementCase(match, trimmedCorrect));
}