import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../../users/users.service';
import { DirectoryConfigService } from '../../directory/directory-config.service';
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
export class LocalAuthProvider implements IAuthenticationProvider {
  readonly id = AUTH_PROVIDER_IDS.LOCAL;
  readonly label = 'Local';

  constructor(
    private readonly usersService: UsersService,
    private readonly directoryConfig: DirectoryConfigService,
    private readonly authAudit: AuthenticationAuditService,
  ) {}

  async isEnabled(): Promise<boolean> {
    const config = await this.directoryConfig.getConfig();
    return config.localLoginEnabled;
  }

  async getPublicInfo(): Promise<AuthProviderPublicInfo> {
    const config = await this.directoryConfig.getConfig();
    return {
      id: this.id,
      label: this.label,
      enabled: config.localLoginEnabled,
      supportsRegistration:
        config.localLoginEnabled && config.localRegistrationEnabled,
      identifierLabel: 'Email',
      identifierPlaceholder: 'you@company.com',
    };
  }

  async authenticate(
    credentials: AuthCredentials,
    context?: AuthProviderAuthenticateContext,
  ): Promise<AuthProviderResult> {
    if (!(await this.isEnabled())) {
      throw new ForbiddenException('Local authentication is disabled');
    }

    const email = credentials.identifier.trim().toLowerCase();
    const user = await this.usersService.findByEmailWithPassword(email);

    if (!user || !user.isActive) {
      this.authAudit.record({
        provider: this.id,
        eventType: AuthAuditEvent.LOGIN_FAILED,
        success: false,
        username: email,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        errorCode: 'invalid_credentials',
        message: 'Invalid credentials',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.passwordHash) {
      this.authAudit.record({
        provider: this.id,
        eventType: AuthAuditEvent.LOGIN_FAILED,
        success: false,
        username: email,
        userId: user.id,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        errorCode: 'password_not_set',
        message: 'This account uses directory authentication',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.authenticationProvider === AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY) {
      const config = await this.directoryConfig.getConfig();
      if (!config.allowLocalFallback) {
        throw new ForbiddenException(
          'This account must sign in with Active Directory',
        );
      }
    }

    const valid = await bcrypt.compare(credentials.password, user.passwordHash);
    if (!valid) {
      this.authAudit.record({
        provider: this.id,
        eventType: AuthAuditEvent.LOGIN_FAILED,
        success: false,
        username: email,
        userId: user.id,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        errorCode: 'invalid_credentials',
        message: 'Invalid credentials',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    this.authAudit.record({
      provider: this.id,
      eventType: AuthAuditEvent.LOGIN_SUCCESS,
      success: true,
      username: email,
      userId: user.id,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return {
      userId: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      provider: this.id,
    };
  }
}
