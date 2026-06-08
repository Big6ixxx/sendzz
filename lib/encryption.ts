import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

/**
 * Derive a key from the encryption key using PBKDF2
 */
function deriveKey(key: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(key, salt, 100000, KEY_LENGTH, "sha256");
}

/**
 * Encrypt data using AES-256-GCM
 * Returns: base64(salt + iv + tag + encrypted)
 */
export function encrypt(data: string, encryptionKey: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(encryptionKey, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(data, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  const buffer = Buffer.concat([salt, iv, tag, encrypted]);
  return buffer.toString("base64");
}

/**
 * Decrypt data using AES-256-GCM
 * Input: base64(salt + iv + tag + encrypted)
 */
export function decrypt(encryptedData: string, encryptionKey: string): string {
  const buffer = Buffer.from(encryptedData, "base64");

  const salt = buffer.subarray(0, SALT_LENGTH);
  const iv = buffer.subarray(SALT_LENGTH, TAG_POSITION);
  const tag = buffer.subarray(TAG_POSITION, ENCRYPTED_POSITION);
  const encrypted = buffer.subarray(ENCRYPTED_POSITION);

  const key = deriveKey(encryptionKey, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
