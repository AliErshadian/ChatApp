import { openMessageLink, splitMessageLinks } from './linkifyMessage';
import type { MessageMention } from './mentions';

export type MessageEntityPart =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string }
  | { type: 'mention'; value: string; userId: string; displayName: string };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitTextMentions(text: string, mentions: MessageMention[]): MessageEntityPart[] {
  if (!mentions.length) {
    return [{ type: 'text', value: text }];
  }

  const usernames = [...new Set(mentions.map((mention) => mention.username).filter(Boolean))];
  const displayNames = [
    ...new Set(
      mentions
        .map((mention) => mention.displayName)
        .filter((name): name is string => Boolean(name && !/\s/.test(name))),
    ),
  ];
  if (!usernames.length && !displayNames.length) {
    return [{ type: 'text', value: text }];
  }

  const mentionLookup = new Map<string, MessageMention>();
  for (const mention of mentions) {
    mentionLookup.set(mention.username.toLowerCase(), mention);
    if (mention.displayName && !/\s/.test(mention.displayName)) {
      mentionLookup.set(mention.displayName.toLowerCase(), mention);
    }
  }

  const tokens = [...usernames, ...displayNames].map(escapeRegExp);
  const pattern = new RegExp(`@(${tokens.join('|')})`, 'gi');
  const parts: MessageEntityPart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, index) });
    }

    const token = match[0];
    const mention = mentionLookup.get(match[1].toLowerCase());
    if (mention) {
      parts.push({
        type: 'mention',
        value: token,
        userId: mention.userId,
        displayName: mention.displayName,
      });
    } else {
      parts.push({ type: 'text', value: token });
    }

    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', value: text }];
}

export function splitMessageEntities(text: string, mentions: MessageMention[] = []): MessageEntityPart[] {
  const linkParts = splitMessageLinks(text);
  const parts: MessageEntityPart[] = [];

  for (const part of linkParts) {
    if (part.type === 'link') {
      parts.push(part);
      continue;
    }

    parts.push(...splitTextMentions(part.value, mentions));
  }

  return parts.length > 0 ? parts : [{ type: 'text', value: text }];
}

export { openMessageLink };
