import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'escape',
};

@Injectable()
export class SanitizationService {
  sanitizeMessage(content: string): string {
    const trimmed = content.trim();
    return sanitizeHtml(trimmed, SANITIZE_OPTIONS);
  }
}
