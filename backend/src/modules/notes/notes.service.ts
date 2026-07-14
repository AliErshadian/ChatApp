import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SanitizationService } from '../../common/services/sanitization.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';
import { UsersService } from '../users/users.service';
import {
  AddNoteMemberDto,
  CreateNoteDto,
  UpdateNoteDto,
  UpdateNoteMemberDto,
} from './dto/note.dto';
import { NoteMember, NoteMemberRole } from './entities/note-member.entity';
import { NoteRevision } from './entities/note-revision.entity';
import { Note } from './entities/note.entity';
import { NoteRealtimePublisher } from './note-realtime.publisher';

export type NoteDto = ReturnType<NotesService['toDto']>;

export interface NoteMemberDto {
  userId: string;
  role: NoteMemberRole;
  user: { id: string; displayName?: string; username?: string; avatarUrl?: string };
  invitedBy: string | null;
  inviter: { id: string; displayName?: string; username?: string; avatarUrl?: string } | null;
  joinedAt: string;
}

export interface NoteRevisionDto {
  id: string;
  noteId: string;
  version: number;
  title: string;
  body: string | null;
  changedFields: string[];
  editedBy: { id: string; displayName?: string; username?: string; avatarUrl?: string };
  createdAt: string;
}

@Injectable()
export class NotesService {
  constructor(
    @InjectRepository(Note)
    private readonly noteRepo: Repository<Note>,
    @InjectRepository(NoteMember)
    private readonly memberRepo: Repository<NoteMember>,
    @InjectRepository(NoteRevision)
    private readonly revisionRepo: Repository<NoteRevision>,
    private readonly usersService: UsersService,
    private readonly sanitization: SanitizationService,
    private readonly audit: AuditService,
    private readonly notePublisher: NoteRealtimePublisher,
  ) {}

  async list(userId: string, scope: 'all' | 'mine' | 'shared' = 'all') {
    const qb = this.noteRepo
      .createQueryBuilder('note')
      .innerJoin(NoteMember, 'member', 'member.note_id = note.id AND member.user_id = :userId', {
        userId,
      })
      .leftJoinAndSelect('note.creator', 'creator')
      .orderBy('note.updated_at', 'DESC');

    if (scope === 'mine') {
      qb.andWhere('note.created_by = :userId', { userId });
    } else if (scope === 'shared') {
      qb.andWhere('note.created_by <> :userId', { userId });
    }

    const notes = await qb.getMany();
    const roleMap = await this.loadRoleMap(
      userId,
      notes.map((n) => n.id),
    );
    const memberCounts = await this.loadMemberCounts(notes.map((n) => n.id));
    const lastEditors = await this.loadLastEditors(notes.map((n) => n.id));

    return notes.map((note) =>
      this.toDto(note, {
        myRole: roleMap.get(note.id) ?? 'reader',
        memberCount: memberCounts.get(note.id) ?? 1,
        lastEditedBy: lastEditors.get(note.id) ?? null,
      }),
    );
  }

  async getById(userId: string, noteId: string) {
    const note = await this.loadNote(noteId);
    const member = await this.getMember(noteId, userId);
    if (!member) throw new ForbiddenException('You do not have access to this note');
    const memberCount = await this.memberRepo.count({ where: { noteId } });
    const lastEditor = await this.loadLastEditor(noteId);
    return this.toDto(note, {
      myRole: member.role,
      memberCount,
      lastEditedBy: lastEditor,
    });
  }

  async create(userId: string, dto: CreateNoteDto) {
    const title = this.sanitization.sanitizeMessage(dto.title);
    if (!title) throw new BadRequestException('Title is required');

    const body = dto.body ? this.sanitization.sanitizeMessage(dto.body) || null : null;

    const note = await this.noteRepo.save(
      this.noteRepo.create({
        title,
        body,
        createdBy: userId,
        version: 1,
      }),
    );

    await this.memberRepo.save(
      this.memberRepo.create({
        noteId: note.id,
        userId,
        role: 'owner',
        invitedBy: null,
      }),
    );

    await this.recordRevision({
      noteId: note.id,
      editedBy: userId,
      version: 1,
      title,
      body,
      changedFields: body ? ['title', 'body'] : ['title'],
    });

    this.audit.record({
      action: AuditAction.NOTE_CREATE,
      userId,
      resourceType: 'note',
      resourceId: note.id,
      metadata: { title },
    });

    const result = await this.getById(userId, note.id);
    await this.publishNote(result, [userId]);
    return result;
  }

  async update(userId: string, noteId: string, dto: UpdateNoteDto) {
    const note = await this.loadNote(noteId);
    const member = await this.requireMember(noteId, userId);
    this.assertCanEdit(member.role);

    if (dto.version !== undefined && dto.version !== note.version) {
      throw new ConflictException('Note was updated by someone else');
    }

    const changedFields: string[] = [];
    let title = note.title;
    let body = note.body;

    if (dto.title !== undefined) {
      const nextTitle = this.sanitization.sanitizeMessage(dto.title);
      if (!nextTitle) throw new BadRequestException('Title is required');
      if (nextTitle !== note.title) {
        title = nextTitle;
        changedFields.push('title');
      }
    }

    if (dto.body !== undefined) {
      const nextBody = dto.body ? this.sanitization.sanitizeMessage(dto.body) || null : null;
      if (nextBody !== note.body) {
        body = nextBody;
        changedFields.push('body');
      }
    }

    if (changedFields.length === 0) {
      return this.getById(userId, noteId);
    }

    note.title = title;
    note.body = body;
    note.version += 1;
    await this.noteRepo.save(note);

    await this.recordRevision({
      noteId: note.id,
      editedBy: userId,
      version: note.version,
      title,
      body,
      changedFields,
    });

    this.audit.record({
      action: AuditAction.NOTE_UPDATE,
      userId,
      resourceType: 'note',
      resourceId: note.id,
      metadata: { changedFields, version: note.version },
    });

    const result = await this.getById(userId, note.id);
    await this.publishNote(result, await this.memberUserIds(noteId));
    return result;
  }

  async remove(userId: string, noteId: string) {
    const member = await this.requireMember(noteId, userId);
    if (member.role !== 'owner') {
      throw new ForbiddenException('Only the owner can delete this note');
    }

    const recipients = await this.memberUserIds(noteId);
    await this.noteRepo.delete({ id: noteId });

    this.audit.record({
      action: AuditAction.NOTE_DELETE,
      userId,
      resourceType: 'note',
      resourceId: noteId,
    });

    await this.notePublisher.publishDeleted(recipients, noteId);
    return { removed: true };
  }

  async listHistory(userId: string, noteId: string) {
    await this.requireMember(noteId, userId);
    const revisions = await this.revisionRepo.find({
      where: { noteId },
      relations: ['editor'],
      order: { version: 'DESC' },
    });
    return revisions.map((r) => this.toRevisionDto(r));
  }

  async clearHistory(userId: string, noteId: string) {
    const member = await this.requireMember(noteId, userId);
    if (member.role !== 'owner') {
      throw new ForbiddenException('Only the owner can clear note history');
    }

    const result = await this.revisionRepo.delete({ noteId });
    const cleared = result.affected ?? 0;

    this.audit.record({
      action: AuditAction.NOTE_CLEAR_HISTORY,
      userId,
      resourceType: 'note',
      resourceId: noteId,
      metadata: { cleared },
    });

    const note = await this.getById(userId, noteId);
    await this.publishNote(note, await this.memberUserIds(noteId));
    return { cleared };
  }

  async listMembers(userId: string, noteId: string) {
    await this.requireMember(noteId, userId);
    const members = await this.memberRepo.find({
      where: { noteId },
      relations: ['user', 'inviter'],
      order: { joinedAt: 'ASC' },
    });
    return members.map((m) => this.toMemberDto(m));
  }

  async addMember(userId: string, noteId: string, dto: AddNoteMemberDto) {
    const member = await this.requireMember(noteId, userId);
    if (member.role !== 'owner') {
      throw new ForbiddenException('Only the owner can share this note');
    }

    const target = await this.usersService.findById(dto.userId);
    if (!target || !target.isActive) {
      throw new NotFoundException('User not found');
    }
    if (dto.userId === userId) {
      throw new BadRequestException('You are already the owner of this note');
    }

    const existing = await this.getMember(noteId, dto.userId);
    if (existing) {
      throw new ConflictException('User already has access to this note');
    }

    await this.memberRepo.save(
      this.memberRepo.create({
        noteId,
        userId: dto.userId,
        role: dto.role,
        invitedBy: userId,
      }),
    );

    this.audit.record({
      action: AuditAction.NOTE_SHARE,
      userId,
      resourceType: 'note',
      resourceId: noteId,
      metadata: { sharedWith: dto.userId, role: dto.role },
    });

    const result = await this.getById(userId, noteId);
    await this.publishNote(result, await this.memberUserIds(noteId));
    return result;
  }

  async updateMember(
    userId: string,
    noteId: string,
    targetUserId: string,
    dto: UpdateNoteMemberDto,
  ) {
    const member = await this.requireMember(noteId, userId);
    if (member.role !== 'owner') {
      throw new ForbiddenException('Only the owner can change member permissions');
    }

    const target = await this.getMember(noteId, targetUserId);
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'owner') {
      throw new BadRequestException('Cannot change the owner role');
    }

    target.role = dto.role;
    await this.memberRepo.save(target);

    this.audit.record({
      action: AuditAction.NOTE_PERMISSION_CHANGE,
      userId,
      resourceType: 'note',
      resourceId: noteId,
      metadata: { targetUserId, role: dto.role },
    });

    const result = await this.getById(userId, noteId);
    await this.publishNote(result, await this.memberUserIds(noteId));
    return result;
  }

  async removeMember(userId: string, noteId: string, targetUserId: string) {
    const member = await this.requireMember(noteId, userId);
    const target = await this.getMember(noteId, targetUserId);
    if (!target) throw new NotFoundException('Member not found');

    if (target.role === 'owner') {
      throw new BadRequestException('Cannot remove the owner');
    }

    const isSelf = targetUserId === userId;
    if (!isSelf && member.role !== 'owner') {
      throw new ForbiddenException('Only the owner can remove members');
    }

    await this.memberRepo.delete({ noteId, userId: targetUserId });

    this.audit.record({
      action: AuditAction.NOTE_UNSHARE,
      userId,
      resourceType: 'note',
      resourceId: noteId,
      metadata: { removedUserId: targetUserId },
    });

    const remaining = await this.memberUserIds(noteId);
    const result = await this.getById(userId, noteId).catch(() => null);
    if (result) {
      await this.publishNote(result, remaining);
    }
    if (!isSelf) {
      await this.notePublisher.publishDeleted([targetUserId], noteId);
    }
    return result ?? { removed: true, noteId };
  }

  private async loadNote(noteId: string) {
    const note = await this.noteRepo.findOne({
      where: { id: noteId },
      relations: ['creator'],
    });
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }

  private async getMember(noteId: string, userId: string) {
    return this.memberRepo.findOne({ where: { noteId, userId } });
  }

  private async requireMember(noteId: string, userId: string) {
    const member = await this.getMember(noteId, userId);
    if (!member) throw new ForbiddenException('You do not have access to this note');
    return member;
  }

  private assertCanEdit(role: NoteMemberRole) {
    if (role === 'reader') {
      throw new ForbiddenException('You have read-only access to this note');
    }
  }

  private async memberUserIds(noteId: string): Promise<string[]> {
    const members = await this.memberRepo.find({
      where: { noteId },
      select: ['userId'],
    });
    return members.map((m) => m.userId);
  }

  private async recordRevision(input: {
    noteId: string;
    editedBy: string;
    version: number;
    title: string;
    body: string | null;
    changedFields: string[];
  }) {
    await this.revisionRepo.save(
      this.revisionRepo.create({
        noteId: input.noteId,
        editedBy: input.editedBy,
        version: input.version,
        title: input.title,
        body: input.body,
        changedFields: input.changedFields,
      }),
    );
  }

  private async publishNote(dto: NoteDto, userIds: string[]) {
    const ids = [...new Set(userIds)];
    await this.notePublisher.publishUpdated(ids, dto);
  }

  private async loadRoleMap(userId: string, noteIds: string[]) {
    const map = new Map<string, NoteMemberRole>();
    if (noteIds.length === 0) return map;
    const members = await this.memberRepo
      .createQueryBuilder('member')
      .where('member.user_id = :userId', { userId })
      .andWhere('member.note_id IN (:...noteIds)', { noteIds })
      .getMany();
    for (const m of members) map.set(m.noteId, m.role);
    return map;
  }

  private async loadMemberCounts(noteIds: string[]) {
    const map = new Map<string, number>();
    if (noteIds.length === 0) return map;
    const rows = await this.memberRepo
      .createQueryBuilder('member')
      .select('member.note_id', 'noteId')
      .addSelect('COUNT(*)', 'count')
      .where('member.note_id IN (:...noteIds)', { noteIds })
      .groupBy('member.note_id')
      .getRawMany<{ noteId: string; count: string }>();
    for (const row of rows) map.set(row.noteId, Number(row.count));
    return map;
  }

  private async loadLastEditors(noteIds: string[]) {
    const map = new Map<string, NoteRevisionDto['editedBy']>();
    if (noteIds.length === 0) return map;
    for (const noteId of noteIds) {
      const editor = await this.loadLastEditor(noteId);
      if (editor) map.set(noteId, editor);
    }
    return map;
  }

  private async loadLastEditor(noteId: string) {
    const revision = await this.revisionRepo.findOne({
      where: { noteId },
      relations: ['editor'],
      order: { version: 'DESC' },
    });
    if (!revision) return null;
    return revision.editor
      ? this.usersService.toPublic(revision.editor)
      : { id: revision.editedBy };
  }

  private toMemberDto(member: NoteMember): NoteMemberDto {
    return {
      userId: member.userId,
      role: member.role,
      user: member.user ? this.usersService.toPublic(member.user) : { id: member.userId },
      invitedBy: member.invitedBy,
      inviter: member.inviter ? this.usersService.toPublic(member.inviter) : null,
      joinedAt: member.joinedAt.toISOString(),
    };
  }

  private toRevisionDto(revision: NoteRevision): NoteRevisionDto {
    return {
      id: revision.id,
      noteId: revision.noteId,
      version: revision.version,
      title: revision.title,
      body: revision.body,
      changedFields: revision.changedFields ?? [],
      editedBy: revision.editor
        ? this.usersService.toPublic(revision.editor)
        : { id: revision.editedBy },
      createdAt: revision.createdAt.toISOString(),
    };
  }

  private toDto(
    note: Note,
    extras: {
      myRole: NoteMemberRole;
      memberCount: number;
      lastEditedBy: { id: string; displayName?: string; username?: string } | null;
    },
  ) {
    return {
      id: note.id,
      title: note.title,
      body: note.body,
      version: note.version,
      createdBy: note.creator
        ? this.usersService.toPublic(note.creator)
        : { id: note.createdBy },
      myRole: extras.myRole,
      memberCount: extras.memberCount,
      isShared: extras.memberCount > 1,
      canEdit: extras.myRole === 'owner' || extras.myRole === 'contributor',
      lastEditedBy: extras.lastEditedBy,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }
}
