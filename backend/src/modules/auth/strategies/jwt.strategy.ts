import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import type { Request } from 'express';
import { AuthService } from '../auth.service';
import { User } from '../../users/entities/user.entity';
import { listAccessJwtSecrets } from '../../../config/jwt-secrets';

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
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
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

  async validate(payload: JwtPayload): Promise<User> {
    return this.authService.validateAccessToken(payload);
  }
}
