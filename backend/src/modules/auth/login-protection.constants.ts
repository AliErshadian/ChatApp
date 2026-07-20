/** Redis / memory keys for login brute-force protection */

export const LOGIN_FAIL_IP_KEY = (ip: string) => `auth:fail:ip:${ip}`;
export const LOGIN_FAIL_ID_KEY = (identifier: string) =>
  `auth:fail:id:${identifier.toLowerCase()}`;

export const LOGIN_CAPTCHA_CODES = {
  REQUIRED: 'CAPTCHA_REQUIRED',
  INVALID: 'CAPTCHA_INVALID',
} as const;

export type CaptchaProviderKind = 'challenge' | 'turnstile';
