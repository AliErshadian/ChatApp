/**
 * Stable identifiers for authentication providers.
 * Add new providers here without changing the login orchestration flow.
 */
export type AuthenticationProviderId = 'local' | 'active_directory';

export const AUTH_PROVIDER_IDS = {
  LOCAL: 'local' as const,
  ACTIVE_DIRECTORY: 'active_directory' as const,
};

export interface AuthCredentials {
  /** Email for local; sAMAccountName / UPN / DOMAIN\\user for AD */
  identifier: string;
  password: string;
  preferredProvider?: AuthenticationProviderId;
}

export interface DirectoryUserProfile {
  username: string;
  displayName: string;
  email: string;
  department?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  phone?: string | null;
  manager?: string | null;
  memberOf: string[];
  adGuid: string;
  adSid: string;
  accountEnabled: boolean;
  accountLocked: boolean;
  passwordExpired: boolean;
  accountExpired: boolean;
  dn: string;
}

export interface AuthProviderResult {
  userId: string;
  email: string;
  username: string;
  displayName: string;
  provider: AuthenticationProviderId;
  directoryProfile?: DirectoryUserProfile;
  created?: boolean;
}

export interface AuthProviderAuthenticateContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthProviderPublicInfo {
  id: AuthenticationProviderId;
  label: string;
  enabled: boolean;
  supportsRegistration: boolean;
  identifierLabel: string;
  identifierPlaceholder: string;
}

/**
 * Strategy interface for pluggable authentication backends.
 * Implementations: LocalAuthProvider, ActiveDirectoryProvider, (future) OAuth/OIDC/SAML.
 */
export interface IAuthenticationProvider {
  readonly id: AuthenticationProviderId;
  readonly label: string;

  isEnabled(): Promise<boolean>;
  getPublicInfo(): Promise<AuthProviderPublicInfo>;

  authenticate(
    credentials: AuthCredentials,
    context?: AuthProviderAuthenticateContext,
  ): Promise<AuthProviderResult>;
}

export const AUTH_PROVIDERS = Symbol('AUTH_PROVIDERS');
