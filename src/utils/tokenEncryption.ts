import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
/** Versioned prefix so we can rotate encryption scheme in the future. */
const VERSION_PREFIX = 'enc:v1:';

/**
 * Derive a deterministic 256-bit key from a passphrase + salt using scrypt.
 * The salt is stored alongside the ciphertext so decryption can reproduce the key.
 */
const deriveKey = (secret: string, salt: Buffer): Buffer =>
  scryptSync(secret, salt, KEY_BYTES);

/**
 * Return the encryption key from environment.
 * Falls back to JWT_SECRET if TOKEN_ENCRYPTION_KEY is not set
 * (still secure as long as the secret is strong and unique per environment).
 */
const getEncryptionSecret = (): string => {
  const key = process.env.TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || process.env.SESSION_SECRET || '';
  if (!key) {
    throw new Error('TOKEN_ENCRYPTION_KEY (or JWT_SECRET) must be set for token encryption');
  }
  return key;
};

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * Output format: `enc:v1:<base64(salt + iv + authTag + ciphertext)>`
 */
export const encryptToken = (plaintext: string): string => {
  const secret = getEncryptionSecret();
  const salt = randomBytes(SALT_BYTES);
  const key = deriveKey(secret, salt);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // salt(16) + iv(12) + authTag(16) + ciphertext(*)
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  return `${VERSION_PREFIX}${combined.toString('base64')}`;
};

/**
 * Decrypt a token string previously encrypted with `encryptToken`.
 * Returns null if the input is not an encrypted token (e.g. legacy plaintext).
 * Throws on decryption failure (wrong key, tampered data).
 */
export const decryptToken = (stored: string): string => {
  if (!stored.startsWith(VERSION_PREFIX)) {
    // Legacy plaintext — return as-is for backward compatibility
    return stored;
  }

  const secret = getEncryptionSecret();
  const combined = Buffer.from(stored.slice(VERSION_PREFIX.length), 'base64');

  const salt = combined.subarray(0, SALT_BYTES);
  const iv = combined.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const authTag = combined.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = combined.subarray(SALT_BYTES + IV_BYTES + AUTH_TAG_BYTES);

  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
};

/** Check whether a stored value is already encrypted. */
export const isEncryptedToken = (value: string): boolean =>
  value.startsWith(VERSION_PREFIX);
