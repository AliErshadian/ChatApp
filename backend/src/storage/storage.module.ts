import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationsModule } from '../modules/conversations/conversations.module';
import { Attachment } from './entities/attachment.entity';
import { S3StorageProvider } from './providers/s3-storage.provider';
import { STORAGE_PROVIDER } from './interfaces/storage-provider.interface';
import { StorageController } from './storage.controller';
import { StorageRepository } from './storage.repository';
import { StorageService } from './storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([Attachment]), forwardRef(() => ConversationsModule)],
  controllers: [StorageController],
  providers: [
    StorageRepository,
    StorageService,
    S3StorageProvider,
    {
      provide: STORAGE_PROVIDER,
      useExisting: S3StorageProvider,
    },
  ],
  exports: [StorageService, STORAGE_PROVIDER],
})
export class StorageModule {}
