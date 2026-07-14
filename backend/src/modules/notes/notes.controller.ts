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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import {
  AddNoteMemberDto,
  CreateNoteDto,
  ListNotesQueryDto,
  UpdateNoteDto,
  UpdateNoteMemberDto,
} from './dto/note.dto';
import { NotesService } from './notes.service';

@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get()
  list(@CurrentUser() user: User, @Query() query: ListNotesQueryDto) {
    return this.notesService.list(user.id, query.scope);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateNoteDto) {
    return this.notesService.create(user.id, dto);
  }

  @Get(':id')
  getOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.notesService.getById(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.notesService.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.notesService.remove(user.id, id);
  }

  @Get(':id/history')
  history(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.notesService.listHistory(user.id, id);
  }

  @Delete(':id/history')
  clearHistory(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.notesService.clearHistory(user.id, id);
  }

  @Get(':id/members')
  members(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.notesService.listMembers(user.id, id);
  }

  @Post(':id/members')
  addMember(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddNoteMemberDto,
  ) {
    return this.notesService.addMember(user.id, id, dto);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateNoteMemberDto,
  ) {
    return this.notesService.updateMember(user.id, id, userId, dto);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.notesService.removeMember(user.id, id, userId);
  }
}
