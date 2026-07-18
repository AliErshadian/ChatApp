import { useStorageUrl } from '../utils/storageUrl';

interface Props {
  story: {
    id: string;
    caption?: string;
    mediaUrl: string;
    mimeType: string;
    authorId: string;
  };
  isOwn?: boolean;
}

export function MessageStoryQuote({ story, isOwn = false }: Props) {
  const url = useStorageUrl(story.mediaUrl);
  const isVideo = story.mimeType.startsWith('video/');

  return (
    <div className={`message-story-quote${isOwn ? ' own' : ' incoming'}`}>
      <div className="message-story-quote-media">
        {url ? (
          isVideo ? (
            <video src={url} muted playsInline />
          ) : (
            <img src={url} alt={story.caption ?? 'Story'} />
          )
        ) : (
          <span className="message-story-quote-fallback">Story</span>
        )}
      </div>
      <div className="message-story-quote-text">
        <strong>Replied to story</strong>
        {story.caption && <span>{story.caption}</span>}
      </div>
    </div>
  );
}
