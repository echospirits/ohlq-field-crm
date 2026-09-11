import { createHash, randomBytes } from 'node:crypto';
import type { AccountLocation } from './accountMemory';

export const CONTACT_IMPORT_SOURCE = 'IPHONE_SHORTCUT';
export const IMPORTED_CONTACT_SOURCE = 'CONTACT_IMPORT';
export const CONTACT_IMPORT_SESSION_MINUTES = 10;
export const IPHONE_SHORTCUT_NAME = 'Send to Neat';

type ImportSessionLike = {
  userId: string;
  organizationId: string;
  accountType: string;
  accountId: string;
  source: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type ContactImportSessionStatus =
  | 'valid'
  | 'expired'
  | 'replayed'
  | 'wrong-user'
  | 'wrong-organization'
  | 'wrong-account'
  | 'wrong-source';

export const createContactImportToken = () => randomBytes(32).toString('base64url');
export const hashContactImportToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const getContactImportExpiry = (now = new Date()) => new Date(now.getTime() + CONTACT_IMPORT_SESSION_MINUTES * 60 * 1000);

export function getIPhoneShortcutConfig() {
  const version = process.env.IPHONE_SHORTCUT_VERSION?.trim() || '1';
  const rawInstallUrl = process.env.IPHONE_SHORTCUT_INSTALL_URL?.trim() || '';
  let installUrl: string | null = null;
  try {
    const parsed = new URL(rawInstallUrl);
    if (parsed.protocol === 'https:') installUrl = parsed.toString();
  } catch {}
  return { installUrl, version };
}

export function validateContactImportSession(
  session: ImportSessionLike,
  context: { userId: string; organizationId: string; location: AccountLocation; now?: Date },
): ContactImportSessionStatus {
  if (session.source !== CONTACT_IMPORT_SOURCE) return 'wrong-source';
  if (session.consumedAt) return 'replayed';
  if (session.expiresAt <= (context.now ?? new Date())) return 'expired';
  if (session.userId !== context.userId) return 'wrong-user';
  if (session.organizationId !== context.organizationId) return 'wrong-organization';
  const accountType = context.location.accountType;
  const accountId = accountType === 'AGENCY' ? context.location.agencyId : context.location.wholesaleAccountId;
  if (session.accountType !== accountType || session.accountId !== accountId) return 'wrong-account';
  return 'valid';
}

export function buildIPhoneShortcutLaunchUrl(input: { state: string; reviewUrl: string; requiredShortcutVersion: string }) {
  const shortcutInput = JSON.stringify({
    schema: 'neat-contact-import',
    state: input.state,
    reviewUrl: input.reviewUrl,
    requiredShortcutVersion: input.requiredShortcutVersion,
  });
  return `shortcuts://run-shortcut?name=${encodeURIComponent(IPHONE_SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(shortcutInput)}`;
}
