import { openMessageLink, splitMessageEntities } from '../utils/messageEntities';
import type { MessageMention } from '../utils/mentions';

interface Props {
  text: string;
  mentions?: MessageMention[];
}

export function LinkifiedMessageText({ text, mentions = [] }: Props) {
  const parts = splitMessageEntities(text, mentions);

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'link') {
          return (
            <a
              key={`${index}-${part.value}`}
              href={part.value}
              className="message-link"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openMessageLink(part.value);
              }}
            >
              {part.value}
            </a>
          );
        }

        if (part.type === 'mention') {
          return (
            <span
              key={`${index}-${part.value}`}
              className="message-mention"
              title={part.displayName}
            >
              {part.value}
            </span>
          );
        }

        return <span key={`${index}-${part.value}`}>{part.value}</span>;
      })}
    </>
  );
}
