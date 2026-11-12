import type { MailboxConnection } from '@prisma/client';

export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export function canReadSupplyMailbox(connection: Pick<MailboxConnection, 'provider' | 'scope' | 'enabled' | 'accessTokenEncrypted'>) {
  return connection.enabled && connection.provider.toLowerCase() === 'google' && connection.scope.split(/\s+/).some(scope => [GMAIL_READ_SCOPE, 'https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/'].includes(scope)) && Boolean(connection.accessTokenEncrypted?.startsWith('supply-v1.'));
}
