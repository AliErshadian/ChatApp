import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { TasksService } from './tasks.service';
import {
  AcceptRejectTaskDto,
  AssignTaskDto,
  CreateTaskDto,
  CreateTaskFromMessageDto,
  ListTasksQueryDto,
  UpdateTaskDto,
} from './dto/task.dto';

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  list(@CurrentUser() user: User, @Query() query: ListTasksQueryDto) {
    return this.tasksService.list(user.id, {
      status: query.status,
      conversationId: query.conversationId,
    });
  }

  @Get('pending/unseen-count')
  getPendingUnseenCount(@CurrentUser() user: User) {
    return this.tasksService.getPendingUnseenCount(user.id);
  }

  @Post('pending/seen')
  markPendingSeen(@CurrentUser() user: User) {
    return this.tasksService.markPendingSeen(user.id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateTaskDto) {
    return this.tasksService.create(user.id, dto);
  }

  @Post('from-message')
  createFromMessage(@CurrentUser() user: User, @Body() dto: CreateTaskFromMessageDto) {
    return this.tasksService.createFromMessage(user.id, dto);
  }

  @Post(':id/assign')
  assign(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTaskDto,
  ) {
    return this.tasksService.assign(user.id, id, dto);
  }

  @Post(':id/accept')
  accept(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptRejectTaskDto,
  ) {
    return this.tasksService.accept(user.id, id, dto.version);
  }

  @Post(':id/reject')
  reject(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptRejectTaskDto,
  ) {
    return this.tasksService.reject(user.id, id, dto.version);
  }

  @Post(':id/cancel-assignment')
  cancelAssignment(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasksService.cancelAssignment(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasksService.remove(user.id, id);
  }
}
