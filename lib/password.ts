import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const PASSWORD_PREFIX = 'scrypt';
const PASSWORD_KEY_LENGTH = 64;

export const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString('base64url');

  return `${PASSWORD_PREFIX}$${salt}$${hash}`;
};

export const verifyPassword = (password: string, storedHash: string | null | undefined) => {
  if (!storedHash) {
    return false;
  }

  const [prefix, salt, hash] = storedHash.split('$');

  if (prefix !== PASSWORD_PREFIX || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(password, salt, expected.length);

  return expected.length === actual.length && timingSafeEqual(new Uint8Array(expected), new Uint8Array(actual));
};
