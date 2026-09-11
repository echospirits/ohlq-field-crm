export const CONTACT_IMPORT_PAYLOAD_SCHEMA_VERSION = 1;

export type ContactImportPayload = {
  schemaVersion: number;
  shortcutVersion: string;
  name: string;
  phones: string[];
  emails: string[];
  jobTitle: string;
};

export const normalizeContactImportField = (value: unknown, max: number) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
  : '';

const cleanList = (value: unknown, max: number) => {
  const input = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(input.map((item) => normalizeContactImportField(item, max)).filter(Boolean))].slice(0, 10);
};

export function parseContactImportPayload(value: unknown): ContactImportPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const schemaVersion = Number(input.schemaVersion);
  const shortcutVersion = normalizeContactImportField(input.shortcutVersion, 40);
  const name = normalizeContactImportField(input.name, 200);
  if (schemaVersion !== CONTACT_IMPORT_PAYLOAD_SCHEMA_VERSION || !shortcutVersion || !name) return null;
  return {
    schemaVersion,
    shortcutVersion,
    name,
    phones: cleanList(input.phones, 100),
    emails: cleanList(input.emails, 320),
    jobTitle: normalizeContactImportField(input.jobTitle, 200),
  };
}

export const isShortcutUpdateRequired = (reportedVersion: string, requiredVersion: string) =>
  reportedVersion.trim() !== requiredVersion.trim();
