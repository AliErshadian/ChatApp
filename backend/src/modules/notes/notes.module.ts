import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SanitizationService } from '../../common/services/sanitization.service';
import { UsersModule } from '../users/users.module';
import { NoteMember } from './entities/note-member.entity';
import { NoteRevision } from './entities/note-revision.entity';
import { Note } from './entities/note.entity';
import { NoteRealtimePublisher } from './note-realtime.publisher';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Note, NoteMember, NoteRevision]), UsersModule],
  controllers: [NotesController],
  providers: [NotesService, SanitizationService, NoteRealtimePublisher],
  exports: [NotesService, NoteRealtimePublisher],
})
export class NotesModule {}
