import type { Locale } from "../types/domain";
import kk from "../locales/kk";
import ru from "../locales/ru";
import uz from "../locales/uz";

const translations = { kk, uz, ru } as const;

export function translate(
  locale: Locale,
  key: keyof typeof ru,
  replacements: Record<string, string | number> = {},
): string {
  const template = translations[locale][key] ?? translations.ru[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(replacements[name] ?? `{${name}}`),
  );
}