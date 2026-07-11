import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    TypeOrmModule.forFeature([RefreshToken, UserSession]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SessionRealtimePublisher, SessionCacheService],
  exports: [AuthService, JwtModule, SessionRealtimePublisher, SessionCacheService],
})
export class AuthModule {}
