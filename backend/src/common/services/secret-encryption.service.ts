import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:v1:';

/**
 * AES-256-GCM encryption for secrets stored in the database (e.g. LDAP bind password).
 * Key material comes from DIRECTORY_ENCRYPTION_KEY (preferred) or is derived from JWT secrets in development.
 */
@Injectable()
export class SecretEncryptionService implements OnModuleInit {
  private readonly logger = new Logger(SecretEncryptionService.name);
  private key!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.key = this.resolveKey();
  }

  encrypt(plaintext: string): string {
    if (!plaintext) return '';
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return (
      PREFIX +
      Buffer.concat([iv, tag, encrypted]).toString('base64url')
    );
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext) return '';
    if (!ciphertext.startsWith(PREFIX)) {
      // Legacy / plaintext fallback during migration — do not persist as plaintext going forward
      this.logger.warn('Decrypting non-prefixed secret; re-save configuration to encrypt at rest');
      return ciphertext;
    }

    const payload = Buffer.from(ciphertext.slice(PREFIX.length), 'base64url');
    const iv = payload.subarray(0, IV_LENGTH);
    const tag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const data = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  isEncrypted(value: string | null | undefined): boolean {
    return Boolean(value?.startsWith(PREFIX));
  }

  private resolveKey(): Buffer {
    const explicit = this.config.get<string>('DIRECTORY_ENCRYPTION_KEY')?.trim();
    if (explicit) {
      if (/^[0-9a-fA-F]{64}$/.test(explicit)) {
        return Buffer.from(explicit, 'hex');
      }
      return createHash('sha256').update(explicit).digest();
    }

    const access = this.config.get<string>('JWT_ACCESS_SECRET', '');
    const refresh = this.config.get<string>('JWT_REFRESH_SECRET', '');
    const nodeEnv = this.config.get<string>('NODE_ENV', 'development');
    if (nodeEnv === 'production') {
      this.logger.warn(
        'DIRECTORY_ENCRYPTION_KEY is not set; deriving from JWT secrets. Set an explicit key in production.',
      );
    }
    return createHash('sha256')
      .update(`chatapp-directory-secrets:${access}:${refresh}`)
      .digest();
  }
}
