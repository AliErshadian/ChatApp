import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { CaptchaProviderKind } from '../utils/authError';
import { getLoginCaptchaHint } from '../utils/authError';

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

export interface LoginCaptchaState {
  required: boolean;
  provider: CaptchaProviderKind;
  turnstileSiteKey?: string;
  captchaToken: string;
  captchaAnswer: string;
  question: string;
}

const INITIAL: LoginCaptchaState = {
  required: false,
  provider: 'challenge',
  captchaToken: '',
  captchaAnswer: '',
  question: '',
};

async function ensureTurnstileScript(): Promise<void> {
  if (window.turnstile) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Turnstile failed to load')), {
        once: true,
      });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.dataset.turnstile = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(script);
  });
}

export function useLoginCaptcha() {
  const [state, setState] = useState<LoginCaptchaState>(INITIAL);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  const refreshChallenge = useCallback(async () => {
    const challenge = await api.createCaptchaChallenge();
    setState((prev) => ({
      ...prev,
      required: true,
      provider: 'challenge',
      captchaToken: challenge.captchaToken,
      question: challenge.question,
      captchaAnswer: '',
    }));
  }, []);

  const applyFromError = useCallback(
    async (error: unknown) => {
      const hint = getLoginCaptchaHint(error);
      if (!hint.required) return;
      if (hint.provider === 'turnstile' && hint.turnstileSiteKey) {
        setState({
          required: true,
          provider: 'turnstile',
          turnstileSiteKey: hint.turnstileSiteKey,
          captchaToken: '',
          captchaAnswer: '',
          question: '',
        });
        return;
      }
      await refreshChallenge();
    },
    [refreshChallenge],
  );

  const checkProtection = useCallback(
    async (identifier?: string) => {
      try {
        const status = await api.getLoginProtection(identifier);
        if (!status.captchaRequired) {
          setState(INITIAL);
          return;
        }
        if (status.captchaProvider === 'turnstile' && status.turnstileSiteKey) {
          setState({
            required: true,
            provider: 'turnstile',
            turnstileSiteKey: status.turnstileSiteKey,
            captchaToken: '',
            captchaAnswer: '',
            question: '',
          });
          return;
        }
        await refreshChallenge();
      } catch {
        // Ignore — server will still enforce on login
      }
    },
    [refreshChallenge],
  );

  useEffect(() => {
    if (!state.required || state.provider !== 'turnstile' || !state.turnstileSiteKey) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await ensureTurnstileScript();
        if (cancelled || !turnstileRef.current || !window.turnstile) return;
        if (widgetIdRef.current) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
        turnstileRef.current.innerHTML = '';
        widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
          sitekey: state.turnstileSiteKey!,
          callback: (token) => {
            setState((prev) => ({ ...prev, captchaToken: token }));
          },
          'expired-callback': () => {
            setState((prev) => ({ ...prev, captchaToken: '' }));
          },
          'error-callback': () => {
            setState((prev) => ({ ...prev, captchaToken: '' }));
          },
        });
      } catch {
        // Fall back to challenge if Turnstile cannot load
        if (!cancelled) await refreshChallenge();
      }
    })();
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [state.required, state.provider, state.turnstileSiteKey, refreshChallenge]);

  const reset = useCallback(() => setState(INITIAL), []);

  const payload =
    state.required && state.captchaToken
      ? {
          captchaToken: state.captchaToken,
          ...(state.provider === 'challenge'
            ? { captchaAnswer: state.captchaAnswer }
            : {}),
        }
      : undefined;

  return {
    state,
    setAnswer: (captchaAnswer: string) => setState((prev) => ({ ...prev, captchaAnswer })),
    refreshChallenge,
    applyFromError,
    checkProtection,
    reset,
    payload,
    turnstileRef,
  };
}

export function LoginCaptchaFields({
  captcha,
}: {
  captcha: ReturnType<typeof useLoginCaptcha>;
}) {
  if (!captcha.state.required) return null;

  if (captcha.state.provider === 'turnstile') {
    return (
      <div className="auth-field auth-captcha">
        <span className="auth-field-label">Verification</span>
        <div ref={captcha.turnstileRef} />
      </div>
    );
  }

  return (
    <div className="auth-field auth-captcha">
      <span className="auth-field-label">Verification</span>
      <div className="auth-captcha-row">
        <p className="auth-captcha-question">{captcha.state.question || 'Loading…'}</p>
        <button
          type="button"
          className="auth-captcha-refresh"
          onClick={() => void captcha.refreshChallenge()}
        >
          Refresh
        </button>
      </div>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={captcha.state.captchaAnswer}
        onChange={(e) => captcha.setAnswer(e.target.value)}
        placeholder="Answer"
        required
      />
    </div>
  );
}
