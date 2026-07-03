import { openMessageLink, splitMessageLinks } from '../utils/linkifyMessage';

interface Props {
  text: string;
}

export function LinkifiedMessageText({ text }: Props) {
  const parts = splitMessageLinks(text);

  return (
    <>
      {parts.map((part, index) =>
        part.type === 'link' ? (
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
        ) : (
          <span key={`${index}-${part.value}`}>{part.value}</span>
        ),
      )}
    </>
  );
}
