import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key() {
  const value = process.env.SUPPLY_MAIL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!value || value.length < 32) throw new Error('SUPPLY_MAIL_TOKEN_ENCRYPTION_KEY requires at least 32 characters.');
  return new Uint8Array(createHash('sha256').update(value).digest());
}
export function encryptSupplyToken(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), new Uint8Array(iv));
  const bytes = Buffer.concat([new Uint8Array(cipher.update(value, 'utf8')), new Uint8Array(cipher.final())]);
  return ['supply-v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), bytes.toString('base64url')].join('.');
}
export function decryptSupplyToken(value: string) {
  const [version, iv, tag, bytes] = value.split('.');
  if (version !== 'supply-v1' || !iv || !tag || !bytes) throw new Error('Mailbox must be reauthorized for Production Supplies.');
  const cipher = createDecipheriv('aes-256-gcm', key(), new Uint8Array(Buffer.from(iv, 'base64url')));
  cipher.setAuthTag(new Uint8Array(Buffer.from(tag, 'base64url')));
  return Buffer.concat([new Uint8Array(cipher.update(new Uint8Array(Buffer.from(bytes, 'base64url')))), new Uint8Array(cipher.final())]).toString('utf8');
}
