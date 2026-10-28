import { spin, type RandomSource } from "./spintax";

export interface TemplateVariables {
  name?: string;
  custom1?: string;
  custom2?: string;
  phone?: string;
}

export interface PersonalizeOptions {
  variables: TemplateVariables;
  enableSpintax?: boolean;
  random?: RandomSource;
}

/** Single pass over `{{...}}` placeholders; unknown keys collapse to "". */
export function interpolateTemplate(template: string, variables: TemplateVariables): string {
  const lookup: Record<string, string> = {
    name: variables.name ?? "",
    custom1: variables.custom1 ?? "",
    custom2: variables.custom2 ?? "",
    phone: variables.phone ?? "",
    "الاسم": variables.name ?? "",
  };

  const source = String(template ?? "");
  let output = "";
  let cursor = 0;
  const placeholder = /\{\{\s*([a-zA-Z0-9_\u0600-\u06FF]+)\s*\}\}/g;

  for (const match of source.matchAll(placeholder)) {
    const index = match.index ?? 0;
    const rawKey = match[1] ?? "";
    const normalized = rawKey.trim().toLowerCase();
    const value = lookup[normalized] ?? lookup[rawKey] ?? "";
    output += source.slice(cursor, index);
    output += String(value).replace(/[\r\n]+/g, " ").trim();
    cursor = index + match[0].length;
  }

  return output + source.slice(cursor);
}

/**
 * Full personalisation pipeline: spin first (placeholders stay opaque), then
 * interpolate values. This guarantees CSV values are never treated as spintax.
 */
export function personalizeMessage(template: string, options: PersonalizeOptions): string {
  const random = options.random ?? Math.random;
  const spun = options.enableSpintax === false ? template : spin(template, random);
  return interpolateTemplate(spun, options.variables).trim();
}

export function extractTemplateVariables(template: string): string[] {
  const found = new Set<string>();
  const placeholder = /\{\{\s*([a-zA-Z0-9_\u0600-\u06FF]+)\s*\}\}/g;
  for (const match of String(template ?? "").matchAll(placeholder)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}
