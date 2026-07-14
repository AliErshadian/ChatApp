import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SanitizationService } from '../../common/services/sanitization.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { Message } from '../messages/entities/message.entity';
import { UsersModule } from '../users/users.module';
import { Task } from './entities/task.entity';
import { TaskUserRead } from './entities/task-user-read.entity';
import { TaskRealtimePublisher } from './task-realtime.publisher';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, TaskUserRead, Message]),
    UsersModule,
    ConversationsModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, SanitizationService, TaskRealtimePublisher],
  exports: [TasksService, TaskRealtimePublisher],
})
export class TasksModule {}
