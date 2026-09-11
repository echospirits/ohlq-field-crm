export type ImportedContact = {
  email: string;
  externalSourceId: string;
  name: string;
  notes: string;
  phone: string;
  role: string;
};

type VCardProperty = { metadata: string; value: string };

const decodeQuotedPrintable = (value: string) => {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < value.length;) {
    const match = value.slice(index).match(/^=([0-9A-F]{2})/i);
    if (match) {
      bytes.push(Number.parseInt(match[1], 16));
      index += 3;
      continue;
    }
    const character = String.fromCodePoint(value.codePointAt(index) ?? 0);
    bytes.push(...encoder.encode(character));
    index += character.length;
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
};

const unescapeText = (value: string) => value.replace(/\\([nN,;\\])/g, (_match, escaped: string) =>
  escaped.toLowerCase() === 'n' ? '\n' : escaped,
);

const decodePropertyValue = ({ metadata, value }: VCardProperty) => unescapeText(
  metadata.includes('ENCODING=QUOTED-PRINTABLE') ? decodeQuotedPrintable(value) : value,
).trim();

const unfoldLines = (source: string) => {
  const physicalLines = source.replace(/\r\n?/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of physicalLines) {
    if (lines.length && (/^[ \t]/.test(line) || lines[lines.length - 1].endsWith('='))) {
      const previous = lines.pop() ?? '';
      lines.push(previous.endsWith('=') ? `${previous.slice(0, -1)}${line.trimStart()}` : `${previous}${line.slice(1)}`);
    } else {
      lines.push(line);
    }
  }
  return lines;
};

const propertiesFromVCard = (source: string) => unfoldLines(source).flatMap((line) => {
  const colon = line.indexOf(':');
  if (colon < 0) return [];
  const metadata = line.slice(0, colon).toUpperCase();
  const groupedName = metadata.split(';')[0];
  const name = groupedName.includes('.') ? groupedName.slice(groupedName.lastIndexOf('.') + 1) : groupedName;
  return [{ metadata, name, value: line.slice(colon + 1) }];
});

const preferredValue = (properties: ReturnType<typeof propertiesFromVCard>, name: string) => {
  const matches = properties.filter((property) => property.name === name);
  const preferred = matches.find((property) => /(?:^|;)PREF(?:=1)?(?:;|$)|TYPE=[^;:]*PREF/.test(property.metadata));
  const mobile = matches.find((property) => /TYPE=[^;:]*(?:CELL|MOBILE)/.test(property.metadata));
  const selected = preferred ?? mobile ?? matches[0];
  return selected ? decodePropertyValue(selected) : '';
};

const nameFromStructuredValue = (property: VCardProperty | undefined) => {
  if (!property) return '';
  const [family, given, additional, prefix, suffix] = decodePropertyValue(property).split(';');
  return [prefix, given, additional, family, suffix].filter(Boolean).join(' ').trim();
};

export const parseVCard = (source: string): ImportedContact => {
  const firstCard = source.match(/BEGIN:VCARD[\s\S]*?END:VCARD/i)?.[0] ?? source;
  const properties = propertiesFromVCard(firstCard);
  const phone = preferredValue(properties, 'TEL').replace(/^tel:/i, '');
  const email = preferredValue(properties, 'EMAIL').replace(/^mailto:/i, '');
  return {
    name: preferredValue(properties, 'FN') || nameFromStructuredValue(properties.find((property) => property.name === 'N')),
    role: preferredValue(properties, 'TITLE') || preferredValue(properties, 'ROLE'),
    email,
    phone,
    notes: preferredValue(properties, 'NOTE'),
    externalSourceId: preferredValue(properties, 'UID'),
  };
};

const escapeText = (value: string) => value
  .replace(/\\/g, '\\\\')
  .replace(/\r?\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

const structuredName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return `;${escapeText(name)};;;`;
  const family = parts.pop() ?? '';
  return `${escapeText(family)};${escapeText(parts.join(' '))};;;`;
};

export const buildVCard = ({
  accountName,
  contact,
}: {
  accountName: string | null;
  contact: { id: string; name: string; role: string | null; phone: string | null; email: string | null; notes: string | null; updatedAt: Date };
}) => [
  'BEGIN:VCARD',
  'VERSION:3.0',
  `FN:${escapeText(contact.name)}`,
  `N:${structuredName(contact.name)}`,
  accountName ? `ORG:${escapeText(accountName)}` : null,
  contact.role ? `TITLE:${escapeText(contact.role)}` : null,
  contact.phone ? `TEL;TYPE=VOICE:${escapeText(contact.phone)}` : null,
  contact.email ? `EMAIL;TYPE=INTERNET:${escapeText(contact.email)}` : null,
  contact.notes ? `NOTE:${escapeText(contact.notes)}` : null,
  `UID:neat-contact-${escapeText(contact.id)}`,
  `REV:${contact.updatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
  'END:VCARD',
].filter(Boolean).join('\r\n') + '\r\n';

export const getVCardFilename = (name: string) => {
  const safe = name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${safe || 'neat-contact'}.vcf`;
};
