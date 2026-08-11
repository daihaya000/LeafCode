/** Client-safe SKILL.md frontmatter parsers (no Node I/O). */

const DESCRIPTION_MAX = 300;

/**
 * Extract a single frontmatter field value. Handles plain values,
 * quoted values, and block scalars (`>`, `|` and their chomping variants).
 * Not a full YAML parser — just enough for skill metadata.
 */
function parseFrontmatterField(
  lines: string[],
  startIndex: number,
  fieldName: string,
): { value: string | undefined; nextIndex: number } {
  const kv = new RegExp(`^${fieldName}\\s*:\\s*(.*)$`).exec(lines[startIndex]);
  if (!kv) return { value: undefined, nextIndex: startIndex };
  let value = kv[1].trim();
  if (/^[>|][+-]?$/.test(value)) {
    // Block scalar: consume following indented (or blank) lines.
    const parts: string[] = [];
    let j = startIndex + 1;
    for (; j < lines.length; j += 1) {
      if (/^\s/.test(lines[j]) || lines[j].trim() === "") {
        parts.push(lines[j].trim());
      } else {
        break;
      }
    }
    value = parts.filter(Boolean).join(" ");
    return { value: value || undefined, nextIndex: j };
  }
  value = value.replace(/^["']|["']$/g, "").trim();
  return { value: value || undefined, nextIndex: startIndex + 1 };
}

function truncateDescription(value: string): string {
  return value.length > DESCRIPTION_MAX
    ? `${value.slice(0, DESCRIPTION_MAX)}…`
    : value;
}

/** Parsed Japanese-localized fields from SKILL.md frontmatter. */
export type SkillFrontmatterJa = {
  title_ja?: string;
  description_ja?: string;
};

/**
 * Extract `description`, `title_ja`, and `description_ja` from SKILL.md
 * frontmatter in a single pass.
 */
export function parseFrontmatterFields(
  markdown: string,
): { description?: string } & SkillFrontmatterJa {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!block) return {};
  const lines = block[1].split(/\r?\n/);
  let description: string | undefined;
  let title_ja: string | undefined;
  let description_ja: string | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^description\s*:/.test(line)) {
      const r = parseFrontmatterField(lines, i, "description");
      if (r.value) description = truncateDescription(r.value);
      i = r.nextIndex - 1; // loop increment will advance
    } else if (/^title_ja\s*:/.test(line)) {
      const r = parseFrontmatterField(lines, i, "title_ja");
      if (r.value) title_ja = r.value;
      i = r.nextIndex - 1;
    } else if (/^description_ja\s*:/.test(line)) {
      const r = parseFrontmatterField(lines, i, "description_ja");
      if (r.value) description_ja = truncateDescription(r.value);
      i = r.nextIndex - 1;
    }
  }
  return { description, title_ja, description_ja };
}

/**
 * Extract `description` from SKILL.md frontmatter.
 * @deprecated Use {@link parseFrontmatterFields} for multi-field extraction.
 */
export function parseFrontmatterDescription(
  markdown: string,
): string | undefined {
  return parseFrontmatterFields(markdown).description;
}
