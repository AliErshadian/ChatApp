import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../modules/auth/strategies/jwt.strategy';

export function listAccessJwtSecrets(config: ConfigService): string[] {
  const current = config.get<string>('JWT_ACCESS_SECRET')?.trim();
  if (!current) return [];

  const secrets = [current];
  const previous = config.get<string>('JWT_ACCESS_SECRET_PREVIOUS')?.trim();
  if (previous && previous !== current) {
    secrets.push(previous);
  }
  return secrets;
}

export async function verifyAccessJwtPayload(
  jwtService: JwtService,
  token: string,
  secrets: string[],
): Promise<JwtPayload> {
  let lastError: unknown;

  for (const secret of secrets) {
    try {
      return await jwtService.verifyAsync<JwtPayload>(token, { secret });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new UnauthorizedException('Invalid token');
}
