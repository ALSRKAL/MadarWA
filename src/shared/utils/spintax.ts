/**
 * Spintax renderer.
 *
 * Supports arbitrarily nested groups such as `{مرحباً|أهلاً {بك|بكم}}`,
 * escaped braces (`\{`) and preserves double-brace template placeholders
 * (`{{name}}`) so they are interpolated *after* spinning. This keeps CSV data
 * containing commas/braces from being mangled by the spintax parser.
 */

export type RandomSource = () => number;

const MAX_DEPTH = 12;
const MAX_OUTPUT = 20_000;

interface ParseResult {
  text: string;
  next: number;
}

function pick(options: string[], random: RandomSource): string {
  const index = Math.floor(random() * options.length);
  return options[Math.min(options.length - 1, Math.max(0, index))] ?? "";
}

function parseGroup(source: string, start: number, random: RandomSource, depth: number): ParseResult {
  if (depth > MAX_DEPTH) {
    return { text: "{", next: start };
  }

  const options: string[] = [];
  let current = "";
  let i = start;

  while (i < source.length) {
    const char = source[i];

    if (char === "\\" && source[i + 1] === "{") {
      current += "{";
      i += 2;
      continue;
    }
    if (char === "\\" && source[i + 1] === "}") {
      current += "}";
      i += 2;
      continue;
    }
    if (char === "{" && source[i + 1] === "{") {
      // Opaque template placeholder: copy verbatim until the closing `}}`.
      const close = source.indexOf("}}", i + 2);
      if (close === -1) {
        current += source.slice(i);
        i = source.length;
        continue;
      }
      current += source.slice(i, close + 2);
      i = close + 2;
      continue;
    }
    if (char === "{") {
      const nested = parseGroup(source, i + 1, random, depth + 1);
      current += nested.text;
      i = nested.next;
      continue;
    }
    if (char === "|") {
      options.push(current);
      current = "";
      i += 1;
      continue;
    }
    if (char === "}") {
      options.push(current);
      return { text: pick(options, random), next: i + 1 };
    }

    current += char;
    i += 1;
  }

  // Unterminated group: leave the source as written rather than losing data.
  options.push(current);
  return { text: `{${options.join("|")}`, next: source.length };
}

export function spin(source: string, random: RandomSource = Math.random): string {
  if (typeof source !== "string" || source.length === 0) return "";
  if (source.length > MAX_OUTPUT || !source.includes("{")) return source;

  let output = "";
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\" && (source[i + 1] === "{" || source[i + 1] === "}")) {
      output += source[i + 1];
      i += 2;
      continue;
    }
    if (char === "{" && source[i + 1] === "{") {
      const close = source.indexOf("}}", i + 2);
      if (close === -1) {
        output += source.slice(i);
        break;
      }
      output += source.slice(i, close + 2);
      i = close + 2;
      continue;
    }
    if (char === "{") {
      const parsed = parseGroup(source, i + 1, random, 0);
      output += parsed.text;
      i = parsed.next;
      continue;
    }
    output += char;
    i += 1;
    if (output.length > MAX_OUTPUT) break;
  }

  return output;
}

/** True when the string contains at least one spintax group. */
export function hasSpintax(source: string): boolean {
  const stripped = String(source ?? "").replace(/\{\{[^{}]*\}\}/g, "");
  return /\{[^{}]*\|[^{}]*\}/.test(stripped);
}
