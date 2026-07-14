import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SanitizationService } from '../../common/services/sanitization.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';
import { ConversationsService } from '../conversations/conversations.service';
import { Message } from '../messages/entities/message.entity';
import { UsersService } from '../users/users.service';
import {
  AssignTaskDto,
  CreateTaskDto,
  CreateTaskFromMessageDto,
  UpdateTaskDto,
} from './dto/task.dto';
import { Task } from './entities/task.entity';
import { TaskUserRead } from './entities/task-user-read.entity';
import { TaskRealtimePublisher } from './task-realtime.publisher';

export type TaskDto = ReturnType<TasksService['toDto']>;

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskUserRead)
    private readonly taskReadRepo: Repository<TaskUserRead>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    private readonly usersService: UsersService,
    private readonly conversationsService: ConversationsService,
    private readonly sanitization: SanitizationService,
    private readonly audit: AuditService,
    private readonly taskPublisher: TaskRealtimePublisher,
  ) {}

  async list(
    userId: string,
    options?: {
      status?: 'open' | 'completed' | 'all' | 'pending';
      conversationId?: string;
    },
  ) {
    const status = options?.status ?? 'open';
    const qb = this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.creator', 'creator')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .leftJoinAndSelect('task.pendingAssignee', 'pendingAssignee')
      .where(
        '(task.created_by = :userId OR task.assigned_to = :userId OR task.pending_assignee_id = :userId)',
        { userId },
      )
      .orderBy('task.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('task.created_at', 'DESC');

    if (status === 'pending') {
      qb.andWhere('task.pending_assignee_id = :userId', { userId }).andWhere(
        'task.completed_at IS NULL',
      );
    } else if (status === 'open') {
      // Open list: creator or accepted assignee. Pending-only offers stay in Pending.
      qb.andWhere('task.completed_at IS NULL').andWhere(
        '(task.created_by = :userId OR task.assigned_to = :userId)',
        { userId },
      );
    } else if (status === 'completed') {
      qb.andWhere('task.completed_at IS NOT NULL').andWhere(
        '(task.created_by = :userId OR task.assigned_to = :userId)',
        { userId },
      );
    }

    if (options?.conversationId) {
      await this.conversationsService.assertMember(options.conversationId, userId);
      qb.andWhere('task.conversation_id = :conversationId', {
        conversationId: options.conversationId,
      });
    }

    const tasks = await qb.getMany();
    const unreadMap = await this.loadUnreadMap(userId, tasks);
    return tasks.map((task) => this.toDto(task, unreadMap.get(task.id) ?? false));
  }

  async create(userId: string, dto: CreateTaskDto) {
    const title = this.sanitization.sanitizeMessage(dto.title);
    if (!title) throw new BadRequestException('Title is required');

    if (dto.conversationId) {
      await this.conversationsService.assertMember(dto.conversationId, userId);
    }

    const requestedAssignee = await this.resolveAssignee(dto.assignedTo);
    const dueAt = this.parseDueAt(dto.dueAt);
    const description = dto.description
      ? this.sanitization.sanitizeMessage(dto.description) || null
      : null;

    const assignment = this.buildAssignmentFields(userId, requestedAssignee);

    const task = await this.taskRepo.save(
      this.taskRepo.create({
        title,
        description,
        conversationId: dto.conversationId ?? null,
        sourceMessageId: null,
        createdBy: userId,
        dueAt,
        completedAt: null,
        ...assignment,
      }),
    );

    this.audit.record({
      action: AuditAction.TASK_CREATE,
      userId,
      resourceType: 'task',
      resourceId: task.id,
      metadata: {
        title,
        assignedTo: assignment.assignedTo,
        pendingAssigneeId: assignment.pendingAssigneeId,
        conversationId: dto.conversationId ?? null,
      },
    });

    const dtoResult = await this.getByIdForUser(task.id, userId);
    await this.publishTask(dtoResult, [
      userId,
      assignment.pendingAssigneeId,
      assignment.assignedTo,
    ]);
    return dtoResult;
  }

  async createFromMessage(userId: string, dto: CreateTaskFromMessageDto) {
    const message = await this.messageRepo.findOne({ where: { id: dto.messageId } });
    if (!message || message.deletedAt) {
      throw new NotFoundException('Message not found');
    }

    await this.conversationsService.assertMember(message.conversationId, userId);

    const defaultTitle = this.titleFromMessage(message);
    const title = this.sanitization.sanitizeMessage(dto.title?.trim() || defaultTitle);
    if (!title) throw new BadRequestException('Title is required');

    const requestedAssignee = await this.resolveAssignee(dto.assignedTo);
    const dueAt = this.parseDueAt(dto.dueAt);
    const description = dto.description
      ? this.sanitization.sanitizeMessage(dto.description) || null
      : null;

    const assignment = this.buildAssignmentFields(userId, requestedAssignee);

    const task = await this.taskRepo.save(
      this.taskRepo.create({
        title,
        description,
        conversationId: message.conversationId,
        sourceMessageId: message.id,
        createdBy: userId,
        dueAt,
        completedAt: null,
        ...assignment,
      }),
    );

    this.audit.record({
      action: AuditAction.TASK_CREATE,
      userId,
      resourceType: 'task',
      resourceId: task.id,
      metadata: {
        title,
        assignedTo: assignment.assignedTo,
        pendingAssigneeId: assignment.pendingAssigneeId,
        conversationId: message.conversationId,
        sourceMessageId: message.id,
      },
    });

    const dtoResult = await this.getByIdForUser(task.id, userId);
    await this.publishTask(dtoResult, [
      userId,
      assignment.pendingAssigneeId,
      assignment.assignedTo,
    ]);
    return dtoResult;
  }

  async update(userId: string, taskId: string, dto: UpdateTaskDto) {
    const task = await this.findAccessible(taskId, userId);
    this.assertCanEdit(task, userId);

    if (dto.title !== undefined) {
      const title = this.sanitization.sanitizeMessage(dto.title);
      if (!title) throw new BadRequestException('Title is required');
      task.title = title;
    }

    if (dto.description !== undefined) {
      task.description = dto.description
        ? this.sanitization.sanitizeMessage(dto.description) || null
        : null;
    }

    if (dto.dueAt !== undefined) {
      task.dueAt = dto.dueAt === null ? null : this.parseDueAt(dto.dueAt);
    }

    if (dto.completed !== undefined) {
      if (task.pendingAssigneeId && task.createdBy !== userId) {
        throw new ForbiddenException('Accept the assignment before completing this task');
      }
      task.completedAt = dto.completed ? task.completedAt ?? new Date() : null;
    }

    await this.taskRepo.save(task);

    this.audit.record({
      action:
        dto.completed === true
          ? AuditAction.TASK_COMPLETE
          : dto.completed === false
            ? AuditAction.TASK_REOPEN
            : AuditAction.TASK_UPDATE,
      userId,
      resourceType: 'task',
      resourceId: task.id,
    });

    const dtoResult = await this.getByIdForUser(task.id, userId);
    await this.publishTask(dtoResult, this.recipientIds(task));
    return dtoResult;
  }

  async assign(userId: string, taskId: string, dto: AssignTaskDto) {
    const task = await this.findAccessible(taskId, userId);
    if (task.createdBy !== userId) {
      throw new ForbiddenException('Only the creator can assign this task');
    }
    if (task.completedAt) {
      throw new BadRequestException('Cannot assign a completed task');
    }
    if (dto.version !== undefined && dto.version !== task.assignmentVersion) {
      throw new ConflictException('Assignment offer is no longer valid');
    }

    const previousRecipients = this.recipientIds(task);
    const requested = await this.resolveAssignee(dto.assigneeId);

    if (requested === null) {
      task.assignedTo = null;
      task.pendingAssigneeId = null;
      task.assignmentOfferedAt = null;
      task.assignmentRespondedAt = new Date();
      task.assignmentVersion += 1;
    } else if (requested === userId) {
      task.assignedTo = userId;
      task.pendingAssigneeId = null;
      task.assignmentOfferedAt = null;
      task.assignmentRespondedAt = new Date();
      task.assignmentVersion += 1;
    } else {
      task.pendingAssigneeId = requested;
      task.assignmentOfferedAt = new Date();
      task.assignmentRespondedAt = null;
      task.assignmentVersion += 1;
      // Keep current assignee until the pending user accepts.
    }

    await this.taskRepo.save(task);

    this.audit.record({
      action: AuditAction.TASK_ASSIGN,
      userId,
      resourceType: 'task',
      resourceId: task.id,
      metadata: {
        assigneeId: requested,
        pendingAssigneeId: task.pendingAssigneeId,
        assignedTo: task.assignedTo,
      },
    });

    const dtoResult = await this.getByIdForUser(task.id, userId);
    await this.publishTask(dtoResult, [
      ...previousRecipients,
      ...this.recipientIds(task),
    ]);
    return dtoResult;
  }

  async accept(userId: string, taskId: string, version?: number) {
    const task = await this.findAccessible(taskId, userId);
    if (task.pendingAssigneeId !== userId) {
      throw new ForbiddenException('You do not have a pending assignment for this task');
    }
    if (task.completedAt) {
      throw new BadRequestException('Cannot accept a completed task');
    }
    if (version !== undefined && version !== task.assignmentVersion) {
      throw new ConflictException('Assignment offer is no longer valid');
    }

    const previousAssignee = task.assignedTo;
    const result = await this.taskRepo.update(
      {
        id: taskId,
        pendingAssigneeId: userId,
        assignmentVersion: task.assignmentVersion,
        completedAt: IsNull(),
      },
      {
        assignedTo: userId,
        pendingAssigneeId: null,
        assignmentOfferedAt: null,
        assignmentRespondedAt: new Date(),
      },
    );

    if (!result.affected) {
      throw new ConflictException('Assignment offer is no longer valid');
    }

    await this.markTaskRead(userId, taskId);

    this.audit.record({
      action: AuditAction.TASK_ACCEPT,
      userId,
      resourceType: 'task',
      resourceId: taskId,
    });

    const dtoResult = await this.getByIdForUser(taskId, userId);
    await this.publishTask(dtoResult, [
      task.createdBy,
      userId,
      previousAssignee,
    ]);
    return dtoResult;
  }

  async reject(userId: string, taskId: string, version?: number) {
    const task = await this.findAccessible(taskId, userId);
    if (task.pendingAssigneeId !== userId) {
      throw new ForbiddenException('You do not have a pending assignment for this task');
    }
    if (version !== undefined && version !== task.assignmentVersion) {
      throw new ConflictException('Assignment offer is no longer valid');
    }

    const previousRecipients = this.recipientIds(task);
    const result = await this.taskRepo.update(
      {
        id: taskId,
        pendingAssigneeId: userId,
        assignmentVersion: task.assignmentVersion,
      },
      {
        pendingAssigneeId: null,
        assignmentOfferedAt: null,
        assignmentRespondedAt: new Date(),
      },
    );

    if (!result.affected) {
      throw new ConflictException('Assignment offer is no longer valid');
    }

    await this.markTaskRead(userId, taskId);

    this.audit.record({
      action: AuditAction.TASK_REJECT,
      userId,
      resourceType: 'task',
      resourceId: taskId,
    });

    // Rejected user loses access unless they are creator/current assignee.
    const stillAccessible =
      task.createdBy === userId || task.assignedTo === userId;
    if (stillAccessible) {
      const dtoResult = await this.getByIdForUser(taskId, userId);
      await this.publishTask(dtoResult, previousRecipients);
      return dtoResult;
    }

    await this.taskPublisher.publishDeleted(previousRecipients, taskId);
    // Creator needs the updated task (no longer pending for this user).
    const forCreator = await this.loadTaskDto(taskId);
    if (forCreator) {
      await this.taskPublisher.publishUpdated([task.createdBy], forCreator);
      if (task.assignedTo && task.assignedTo !== task.createdBy) {
        await this.taskPublisher.publishUpdated([task.assignedTo], forCreator);
      }
    }
    return { rejected: true, taskId };
  }

  async cancelAssignment(userId: string, taskId: string) {
    const task = await this.findAccessible(taskId, userId);
    if (task.createdBy !== userId) {
      throw new ForbiddenException('Only the creator can cancel a pending assignment');
    }
    if (!task.pendingAssigneeId) {
      throw new BadRequestException('No pending assignment to cancel');
    }

    const previousPending = task.pendingAssigneeId;
    const previousRecipients = this.recipientIds(task);
    task.pendingAssigneeId = null;
    task.assignmentOfferedAt = null;
    task.assignmentVersion += 1;
    await this.taskRepo.save(task);

    this.audit.record({
      action: AuditAction.TASK_CANCEL_ASSIGNMENT,
      userId,
      resourceType: 'task',
      resourceId: task.id,
      metadata: { cancelledPendingAssigneeId: previousPending },
    });

    const dtoResult = await this.getByIdForUser(task.id, userId);
    await this.publishTask(dtoResult, previousRecipients);
    // Notify previous pending user they no longer have access (if they weren't assignee/creator)
    if (
      previousPending !== task.createdBy &&
      previousPending !== task.assignedTo
    ) {
      await this.taskPublisher.publishDeleted([previousPending], task.id);
    }
    return dtoResult;
  }

  async getPendingUnseenCount(userId: string): Promise<{ count: number }> {
    const count = await this.taskRepo
      .createQueryBuilder('task')
      .leftJoin(
        TaskUserRead,
        'read',
        'read.task_id = task.id AND read.user_id = :userId',
        { userId },
      )
      .where('task.pending_assignee_id = :userId', { userId })
      .andWhere('task.completed_at IS NULL')
      .andWhere(
        '(read.last_read_at IS NULL OR read.last_read_at < task.assignment_offered_at)',
      )
      .getCount();
    return { count };
  }

  async markPendingSeen(userId: string): Promise<{ count: number }> {
    const pending = await this.taskRepo.find({
      where: { pendingAssigneeId: userId },
      select: ['id'],
    });
    if (pending.length === 0) return { count: 0 };

    const now = new Date();
    await this.taskReadRepo.upsert(
      pending.map((task) => ({
        taskId: task.id,
        userId,
        lastReadAt: now,
      })),
      ['taskId', 'userId'],
    );
    return { count: pending.length };
  }

  async remove(userId: string, taskId: string) {
    const task = await this.findAccessible(taskId, userId);
    if (task.createdBy !== userId) {
      throw new ForbiddenException('Only the creator can delete this task');
    }
    const recipients = this.recipientIds(task);
    await this.taskRepo.delete({ id: taskId });
    this.audit.record({
      action: AuditAction.TASK_DELETE,
      userId,
      resourceType: 'task',
      resourceId: taskId,
    });
    await this.taskPublisher.publishDeleted(recipients, taskId);
    return { removed: true };
  }

  private buildAssignmentFields(
    creatorId: string,
    requestedAssignee: string | null,
  ): {
    assignedTo: string | null;
    pendingAssigneeId: string | null;
    assignmentVersion: number;
    assignmentOfferedAt: Date | null;
    assignmentRespondedAt: Date | null;
  } {
    if (!requestedAssignee) {
      return {
        assignedTo: null,
        pendingAssigneeId: null,
        assignmentVersion: 0,
        assignmentOfferedAt: null,
        assignmentRespondedAt: null,
      };
    }
    if (requestedAssignee === creatorId) {
      return {
        assignedTo: creatorId,
        pendingAssigneeId: null,
        assignmentVersion: 1,
        assignmentOfferedAt: null,
        assignmentRespondedAt: new Date(),
      };
    }
    return {
      assignedTo: null,
      pendingAssigneeId: requestedAssignee,
      assignmentVersion: 1,
      assignmentOfferedAt: new Date(),
      assignmentRespondedAt: null,
    };
  }

  private async getByIdForUser(taskId: string, userId: string) {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['creator', 'assignee', 'pendingAssignee'],
    });
    if (!task) throw new NotFoundException('Task not found');
    this.assertCanAccess(task, userId);
    const unreadMap = await this.loadUnreadMap(userId, [task]);
    return this.toDto(task, unreadMap.get(task.id) ?? false);
  }

  private async loadTaskDto(taskId: string) {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['creator', 'assignee', 'pendingAssignee'],
    });
    if (!task) return null;
    return this.toDto(task, false);
  }

  private async findAccessible(taskId: string, userId: string) {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['creator', 'assignee', 'pendingAssignee'],
    });
    if (!task) throw new NotFoundException('Task not found');
    this.assertCanAccess(task, userId);
    return task;
  }

  private assertCanAccess(task: Task, userId: string) {
    if (
      task.createdBy !== userId &&
      task.assignedTo !== userId &&
      task.pendingAssigneeId !== userId
    ) {
      throw new ForbiddenException('You do not have access to this task');
    }
  }

  private assertCanEdit(task: Task, userId: string) {
    if (task.createdBy === userId) return;
    if (task.assignedTo === userId && !task.pendingAssigneeId) return;
    if (task.assignedTo === userId && task.pendingAssigneeId !== userId) return;
    throw new ForbiddenException('You cannot edit this task');
  }

  private recipientIds(task: {
    createdBy: string;
    assignedTo: string | null;
    pendingAssigneeId: string | null;
  }): string[] {
    return [
      ...new Set(
        [task.createdBy, task.assignedTo, task.pendingAssigneeId].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
  }

  private async publishTask(dto: TaskDto, userIds: Array<string | null | undefined>) {
    const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    await this.taskPublisher.publishUpdated(ids, dto);
  }

  private async markTaskRead(userId: string, taskId: string) {
    await this.taskReadRepo.upsert(
      { taskId, userId, lastReadAt: new Date() },
      ['taskId', 'userId'],
    );
  }

  private async loadUnreadMap(userId: string, tasks: Task[]): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>();
    const pendingIds = tasks
      .filter((t) => t.pendingAssigneeId === userId && t.assignmentOfferedAt)
      .map((t) => t.id);
    if (pendingIds.length === 0) return map;

    const reads = await this.taskReadRepo
      .createQueryBuilder('read')
      .where('read.user_id = :userId', { userId })
      .andWhere('read.task_id IN (:...ids)', { ids: pendingIds })
      .getMany();
    const readByTask = new Map(reads.map((r) => [r.taskId, r.lastReadAt]));

    for (const task of tasks) {
      if (task.pendingAssigneeId !== userId || !task.assignmentOfferedAt) {
        map.set(task.id, false);
        continue;
      }
      const lastRead = readByTask.get(task.id);
      map.set(
        task.id,
        !lastRead || lastRead.getTime() < task.assignmentOfferedAt.getTime(),
      );
    }
    return map;
  }

  private async resolveAssignee(userId?: string | null): Promise<string | null> {
    if (!userId) return null;
    const user = await this.usersService.findById(userId);
    if (!user || !user.isActive) {
      throw new NotFoundException('Assignee not found');
    }
    return user.id;
  }

  private parseDueAt(value?: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid due date');
    }
    return date;
  }

  private titleFromMessage(message: Message): string {
    const text =
      message.contentType === 'text/plain' || !message.contentType
        ? message.content
        : message.caption || message.fileName || message.content;
    const trimmed = (text ?? '').trim().replace(/\s+/g, ' ');
    if (!trimmed) return 'Task from message';
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
  }

  private assignmentStatus(task: Task): 'unassigned' | 'pending' | 'assigned' {
    if (task.pendingAssigneeId) return 'pending';
    if (task.assignedTo) return 'assigned';
    return 'unassigned';
  }

  private toDto(task: Task, isUnread = false) {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      conversationId: task.conversationId,
      sourceMessageId: task.sourceMessageId,
      createdBy: task.creator
        ? this.usersService.toPublic(task.creator)
        : { id: task.createdBy },
      assignedTo: task.assignee
        ? this.usersService.toPublic(task.assignee)
        : task.assignedTo
          ? { id: task.assignedTo }
          : null,
      pendingAssignee: task.pendingAssignee
        ? this.usersService.toPublic(task.pendingAssignee)
        : task.pendingAssigneeId
          ? { id: task.pendingAssigneeId }
          : null,
      assignmentStatus: this.assignmentStatus(task),
      assignmentVersion: task.assignmentVersion,
      assignmentOfferedAt: task.assignmentOfferedAt?.toISOString() ?? null,
      assignmentRespondedAt: task.assignmentRespondedAt?.toISOString() ?? null,
      dueAt: task.dueAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      completed: Boolean(task.completedAt),
      isUnread,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }
}
