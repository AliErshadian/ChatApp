import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DirectoryConfigService } from '../../directory/directory-config.service';
import { LdapClientService } from '../../directory/ldap/ldap-client.service';
import { DirectoryUserProvisioningService } from '../../directory/directory-user-provisioning.service';
import {
  AuthAuditEvent,
  AuthenticationAuditService,
} from '../../directory/authentication-audit.service';
import {
  AUTH_PROVIDER_IDS,
  type AuthCredentials,
  type AuthProviderAuthenticateContext,
  type AuthProviderPublicInfo,
  type AuthProviderResult,
  type IAuthenticationProvider,
} from './auth-provider.types';

@Injectable()
export class ActiveDirectoryAuthProvider implements IAuthenticationProvider {
  readonly id = AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY;
  readonly label = 'Active Directory';

  constructor(
    private readonly directoryConfig: DirectoryConfigService,
    private readonly ldap: LdapClientService,
    private readonly provisioning: DirectoryUserProvisioningService,
    private readonly authAudit: AuthenticationAuditService,
  ) {}

  async isEnabled(): Promise<boolean> {
    const config = await this.directoryConfig.getConfig();
    return config.activeDirectoryLoginEnabled;
  }

  async getPublicInfo(): Promise<AuthProviderPublicInfo> {
    const config = await this.directoryConfig.getConfig();
    const domain = config.domainName?.trim();
    return {
      id: this.id,
      label: this.label,
      enabled: await this.isEnabled(),
      supportsRegistration: false,
      identifierLabel: 'Username',
      identifierPlaceholder: domain
        ? `username or ${domain}\\username`
        : 'DOMAIN\\username',
    };
  }

  async authenticate(
    credentials: AuthCredentials,
    context?: AuthProviderAuthenticateContext,
  ): Promise<AuthProviderResult> {
    if (!(await this.isEnabled())) {
      throw new ForbiddenException('Active Directory authentication is disabled');
    }

    const config = await this.directoryConfig.getConfig();
    const bindPassword = this.directoryConfig.getBindPassword(config);
    const username = credentials.identifier.trim();

    if (!config.ldapHost || !config.bindDn || !bindPassword) {
      this.authAudit.record({
        provider: this.id,
        eventType: AuthAuditEvent.CONNECTION_ERROR,
        success: false,
        username,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        errorCode: 'not_configured',
        message: 'Directory is not configured',
      });
      throw new UnauthorizedException('Directory authentication is unavailable');
    }

    try {
      const profile = await this.ldap.authenticateUser(
        config,
        bindPassword,
        username,
        credentials.password,
      );

      await this.provisioning.assertLoginAllowed(profile);
      const { user, created } = await this.provisioning.findOrProvision(profile);

      if (!user.isActive) {
        throw new UnauthorizedException('Account is inactive');
      }

      this.authAudit.record({
        provider: this.id,
        eventType: AuthAuditEvent.LOGIN_SUCCESS,
        success: true,
        username,
        userId: user.id,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { created, adGuid: profile.adGuid },
      });

      return {
        userId: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        provider: this.id,
        directoryProfile: profile,
        created,
      };
    } catch (err) {
      if (
        err instanceof UnauthorizedException ||
        err instanceof ForbiddenException
      ) {
        this.authAudit.record({
          provider: this.id,
          eventType: AuthAuditEvent.LOGIN_FAILED,
          success: false,
          username,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          errorCode: 'rejected',
          message: err.message,
        });
        throw err;
      }

      const message = err instanceof Error ? err.message : 'Authentication failed';
      this.authAudit.record({
        provider: this.id,
        eventType: AuthAuditEvent.LOGIN_FAILED,
        success: false,
        username,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        errorCode: 'auth_failed',
        message,
      });
      throw new UnauthorizedException(
        message === 'Invalid credentials' || message === 'Directory server unavailable'
          ? message === 'Directory server unavailable'
            ? 'Directory authentication is temporarily unavailable'
            : 'Invalid credentials'
          : 'Invalid credentials',
      );
    }
  }
}
