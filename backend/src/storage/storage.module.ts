import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from '../modules/messages/entities/message.entity';
import { MessageUserHidden } from '../modules/messages/entities/message-user-hidden.entity';
import { User } from '../modules/users/entities/user.entity';
import { Story } from '../modules/stories/entities/story.entity';
import { UserContact } from '../modules/contacts/entities/user-contact.entity';
import { ConversationsModule } from '../modules/conversations/conversations.module';
import { Attachment } from './entities/attachment.entity';
import { FileScanHook } from './hooks/file-scan.hook';
import { STORAGE_HOOKS } from './interfaces/storage-hooks.interface';
import { S3StorageProvider } from './providers/s3-storage.provider';
import { STORAGE_PROVIDER } from './interfaces/storage-provider.interface';
import { StorageController } from './storage.controller';
import { StorageRepository } from './storage.repository';
import { StorageService } from './storage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Attachment,
      Message,
      MessageUserHidden,
      User,
      Story,
      UserContact,
    ]),
    forwardRef(() => ConversationsModule),
  ],
  controllers: [StorageController],
  providers: [
    StorageRepository,
    StorageService,
    S3StorageProvider,
    FileScanHook,
    {
      provide: STORAGE_PROVIDER,
      useExisting: S3StorageProvider,
    },
    {
      provide: STORAGE_HOOKS,
      useFactory: (fileScan: FileScanHook) => [fileScan],
      inject: [FileScanHook],
    },
  ],
  exports: [StorageService, STORAGE_PROVIDER],
})
export class StorageModule {}
