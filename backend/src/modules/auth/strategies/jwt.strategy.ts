import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import type { Request } from 'express';
import { AuthService } from '../auth.service';
import { listAccessJwtSecrets } from '../../../config/jwt-secrets';
import { AuthenticatedUser } from '../types/authenticated-user';

export interface JwtPayload {
  sub: string;
  email: string;
  sid?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    const secrets = listAccessJwtSecrets(config);

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request) => {
          const token = request.query?.access_token;
          return typeof token === 'string' ? token : null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKeyProvider: (
        _request: Request,
        rawJwtToken: string,
        done: (error: Error | null, secret?: string) => void,
      ) => {
        for (const secret of secrets) {
          try {
            verify(rawJwtToken, secret);
            done(null, secret);
            return;
          } catch {
            // try previous secret during rotation window
          }
        }
        done(new UnauthorizedException('Invalid token'), undefined);
      },
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.authService.validateAccessToken(payload);
    if (!payload.sid) {
      throw new UnauthorizedException('Session required');
    }
    return { ...user, sessionId: payload.sid };
  }
}
