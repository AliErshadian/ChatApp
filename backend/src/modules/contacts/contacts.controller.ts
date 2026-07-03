import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ContactsService } from './contacts.service';
import { AddContactDto } from './dto/contact.dto';

@Controller('contacts')
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.contactsService.list(user.id);
  }

  @Post()
  add(@CurrentUser() user: User, @Body() dto: AddContactDto) {
    return this.contactsService.add(user.id, dto.userId);
  }

  @Delete(':userId')
  remove(
    @CurrentUser() user: User,
    @Param('userId', ParseUUIDPipe) contactUserId: string,
  ) {
    return this.contactsService.remove(user.id, contactUserId);
  }
}
