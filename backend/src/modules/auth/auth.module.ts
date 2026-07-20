import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SessionRealtimePublisher } from './session-realtime.publisher';
import { SessionCacheService } from './session-cache.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserSession } from './entities/user-session.entity';
import { UsersModule } from '../users/users.module';
import { DirectoryModule } from '../directory/directory.module';
import { AUTH_PROVIDERS } from './providers/auth-provider.types';
import { LocalAuthProvider } from './providers/local-auth.provider';
import { ActiveDirectoryAuthProvider } from './providers/active-directory.provider';
import { AuthenticationManager } from './providers/authentication-manager.service';

@Module({
  imports: [
    UsersModule,
    forwardRef(() => DirectoryModule),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    TypeOrmModule.forFeature([RefreshToken, UserSession]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    SessionRealtimePublisher,
    SessionCacheService,
    LocalAuthProvider,
    ActiveDirectoryAuthProvider,
    AuthenticationManager,
    {
      provide: AUTH_PROVIDERS,
      useFactory: (
        local: LocalAuthProvider,
        ad: ActiveDirectoryAuthProvider,
      ) => [local, ad],
      inject: [LocalAuthProvider, ActiveDirectoryAuthProvider],
    },
  ],
  exports: [
    AuthService,
    JwtModule,
    SessionRealtimePublisher,
    SessionCacheService,
    AuthenticationManager,
  ],
})
export class AuthModule {}
