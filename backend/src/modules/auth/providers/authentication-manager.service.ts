import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DirectoryConfigService } from '../../directory/directory-config.service';
import {
  AUTH_PROVIDERS,
  AUTH_PROVIDER_IDS,
  type AuthCredentials,
  type AuthProviderAuthenticateContext,
  type AuthProviderPublicInfo,
  type AuthProviderResult,
  type AuthenticationProviderId,
  type IAuthenticationProvider,
} from './auth-provider.types';

/**
 * Selects and invokes the correct authentication provider based on runtime configuration.
 * Adding a new provider only requires registering it in AUTH_PROVIDERS — no flow changes.
 */
@Injectable()
export class AuthenticationManager {
  constructor(
    @Inject(AUTH_PROVIDERS)
    private readonly providers: IAuthenticationProvider[],
    private readonly directoryConfig: DirectoryConfigService,
  ) {}

  private getProviderMap(): Map<AuthenticationProviderId, IAuthenticationProvider> {
    return new Map(this.providers.map((p) => [p.id, p]));
  }

  async listPublicProviders(): Promise<{
    providers: AuthProviderPublicInfo[];
    defaultProvider: AuthenticationProviderId;
  }> {
    const config = await this.directoryConfig.getConfig();
    const providers = await Promise.all(
      this.providers.map((p) => p.getPublicInfo()),
    );
    return {
      providers: providers.filter((p) => p.enabled),
      defaultProvider: config.defaultProvider,
    };
  }

  async authenticate(
    credentials: AuthCredentials,
    context?: AuthProviderAuthenticateContext,
  ): Promise<AuthProviderResult> {
    const config = await this.directoryConfig.getConfig();
    const map = this.getProviderMap();

    const preferred =
      credentials.preferredProvider ??
      this.inferProvider(credentials.identifier, config);

    const tryOrder: AuthenticationProviderId[] = [preferred];

    // Optional fallback: AD failure → local when allowed and both enabled
    if (
      preferred === AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY &&
      config.allowLocalFallback &&
      config.localLoginEnabled
    ) {
      tryOrder.push(AUTH_PROVIDER_IDS.LOCAL);
    }

    let lastError: unknown;

    for (const providerId of tryOrder) {
      const provider = map.get(providerId);
      if (!provider) continue;
      if (!(await provider.isEnabled())) continue;

      try {
        return await provider.authenticate(
          { ...credentials, preferredProvider: providerId },
          context,
        );
      } catch (err) {
        lastError = err;
        if (tryOrder.length === 1) throw err;
        if (
          err instanceof UnauthorizedException &&
          providerId === AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY &&
          tryOrder.includes(AUTH_PROVIDER_IDS.LOCAL)
        ) {
          continue;
        }
        throw err;
      }
    }

    if (lastError) throw lastError;
    throw new BadRequestException('No authentication provider is available');
  }

  /**
   * When the client omits `provider`, pick a sensible default:
   * - email-shaped identifiers → local (backward compatible)
   * - DOMAIN\\user or bare username → Active Directory when enabled
   * - otherwise → configured default provider
   */
  private inferProvider(
    identifier: string,
    config: {
      defaultProvider: AuthenticationProviderId;
      localLoginEnabled: boolean;
      activeDirectoryLoginEnabled: boolean;
    },
  ): AuthenticationProviderId {
    const id = identifier.trim();
    const looksLikeEmail = id.includes('@') && !id.includes('\\');
    const looksLikeDomainUser = id.includes('\\') || id.includes('@');

    if (looksLikeEmail && config.localLoginEnabled) {
      return AUTH_PROVIDER_IDS.LOCAL;
    }
    if (
      (id.includes('\\') || (!looksLikeEmail && !id.includes('@'))) &&
      config.activeDirectoryLoginEnabled
    ) {
      return AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY;
    }
    if (looksLikeDomainUser && config.activeDirectoryLoginEnabled && id.includes('@')) {
      // UPN form: prefer AD when enabled
      return AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY;
    }
    return config.defaultProvider;
  }

  getProvider(id: AuthenticationProviderId): IAuthenticationProvider | undefined {
    return this.getProviderMap().get(id);
  }
}
