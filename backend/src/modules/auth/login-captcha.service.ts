import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import {
  CaptchaProviderKind,
  LOGIN_CAPTCHA_CODES,
} from './login-protection.constants';

interface ChallengePayload {
  a: number;
  b: number;
  exp: number;
  nonce: string;
}

@Injectable()
export class LoginCaptchaService {
  private readonly logger = new Logger(LoginCaptchaService.name);
  private readonly hmacSecret: string;
  private readonly challengeTtlSeconds = 300;
  private readonly turnstileSecret?: string;
  private readonly turnstileSiteKey?: string;

  constructor(config: ConfigService) {
    this.hmacSecret =
      config.get<string>('CAPTCHA_HMAC_SECRET') ||
      config.get<string>('JWT_ACCESS_SECRET') ||
      'dev-captcha-secret-change-me';
    this.turnstileSecret = config.get<string>('TURNSTILE_SECRET_KEY') || undefined;
    this.turnstileSiteKey = config.get<string>('TURNSTILE_SITE_KEY') || undefined;
  }

  getProvider(): CaptchaProviderKind {
    return this.turnstileSecret && this.turnstileSiteKey ? 'turnstile' : 'challenge';
  }

  getPublicConfig(): {
    provider: CaptchaProviderKind;
    turnstileSiteKey?: string;
  } {
    const provider = this.getProvider();
    return {
      provider,
      ...(provider === 'turnstile' && this.turnstileSiteKey
        ? { turnstileSiteKey: this.turnstileSiteKey }
        : {}),
    };
  }

  createChallenge(): { captchaToken: string; question: string; expiresIn: number } {
    const a = randomInt(1, 12);
    const b = randomInt(1, 12);
    const payload: ChallengePayload = {
      a,
      b,
      exp: Math.floor(Date.now() / 1000) + this.challengeTtlSeconds,
      nonce: randomInt(1e9, 2e9).toString(36),
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = this.sign(body);
    return {
      captchaToken: `${body}.${sig}`,
      question: `What is ${a} + ${b}?`,
      expiresIn: this.challengeTtlSeconds,
    };
  }

  async assertValid(input: {
    captchaToken?: string;
    captchaAnswer?: string;
  }): Promise<void> {
    const provider = this.getProvider();
    if (provider === 'turnstile') {
      await this.verifyTurnstile(input.captchaToken);
      return;
    }
    this.verifyChallenge(input.captchaToken, input.captchaAnswer);
  }

  private verifyChallenge(token?: string, answer?: string): void {
    if (!token || answer === undefined || answer === null || String(answer).trim() === '') {
      throw new BadRequestException({
        statusCode: 400,
        message: 'CAPTCHA answer is required',
        code: LOGIN_CAPTCHA_CODES.INVALID,
        captchaRequired: true,
        captchaProvider: 'challenge' as CaptchaProviderKind,
      });
    }

    const [body, sig] = token.split('.');
    if (!body || !sig || !this.signaturesEqual(sig, this.sign(body))) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'CAPTCHA challenge is invalid or expired',
        code: LOGIN_CAPTCHA_CODES.INVALID,
        captchaRequired: true,
        captchaProvider: 'challenge' as CaptchaProviderKind,
      });
    }

    let payload: ChallengePayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ChallengePayload;
    } catch {
      throw new BadRequestException({
        statusCode: 400,
        message: 'CAPTCHA challenge is invalid or expired',
        code: LOGIN_CAPTCHA_CODES.INVALID,
        captchaRequired: true,
        captchaProvider: 'challenge' as CaptchaProviderKind,
      });
    }

    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'CAPTCHA challenge expired. Refresh and try again.',
        code: LOGIN_CAPTCHA_CODES.INVALID,
        captchaRequired: true,
        captchaProvider: 'challenge' as CaptchaProviderKind,
      });
    }

    const expected = String(payload.a + payload.b);
    const provided = String(answer).trim();
    if (expected !== provided) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Incorrect CAPTCHA answer',
        code: LOGIN_CAPTCHA_CODES.INVALID,
        captchaRequired: true,
        captchaProvider: 'challenge' as CaptchaProviderKind,
      });
    }
  }

  private async verifyTurnstile(token?: string): Promise<void> {
    if (!token?.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'CAPTCHA verification required',
        code: LOGIN_CAPTCHA_CODES.REQUIRED,
        captchaRequired: true,
        captchaProvider: 'turnstile' as CaptchaProviderKind,
      });
    }

    try {
      const body = new URLSearchParams({
        secret: this.turnstileSecret!,
        response: token,
      });
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const data = (await res.json()) as { success?: boolean };
      if (!data.success) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'CAPTCHA verification failed',
          code: LOGIN_CAPTCHA_CODES.INVALID,
          captchaRequired: true,
          captchaProvider: 'turnstile' as CaptchaProviderKind,
        });
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(
        `Turnstile verify failed: ${err instanceof Error ? err.message : err}`,
      );
      throw new BadRequestException({
        statusCode: 400,
        message: 'CAPTCHA verification unavailable',
        code: LOGIN_CAPTCHA_CODES.INVALID,
        captchaRequired: true,
        captchaProvider: 'turnstile' as CaptchaProviderKind,
      });
    }
  }

  private sign(body: string): string {
    return createHmac('sha256', this.hmacSecret).update(body).digest('base64url');
  }

  private signaturesEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }
}
