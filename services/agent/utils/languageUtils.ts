import prompts from '../../../config/prompts';

export type LanguageCode = keyof typeof prompts.languageInstructions;

export function getLanguageInstruction(langCode: string): string {
  const code = langCode as LanguageCode;
  return prompts.languageInstructions[code] ?? prompts.languageInstructions.he ?? '';
}

module.exports = {
  getLanguageInstruction
};

