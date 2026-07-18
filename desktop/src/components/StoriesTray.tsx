import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import type { StoryFeedRing } from '../services/api';

interface Props {
  rings: StoryFeedRing[];
  currentUserId?: string;
  onOpenUser: (userId: string) => void;
  onAddStory: () => void;
}

export function StoriesTray({ rings, currentUserId, onOpenUser, onAddStory }: Props) {
  if (!currentUserId) return null;

  return (
    <div className="stories-tray" aria-label="Stories">
      <div className="stories-tray-scroll">
        {rings.map((ring) => {
          const isSelf = ring.userId === currentUserId;
          const canOpen = ring.storyCount > 0;

          if (isSelf) {
            return (
              <div key={ring.userId} className="stories-tray-item stories-tray-item--self">
                <div className="stories-tray-ring-wrap">
                  <button
                    type="button"
                    className="stories-tray-ring-btn"
                    onClick={() => {
                      if (canOpen) onOpenUser(ring.userId);
                      else onAddStory();
                    }}
                    title={canOpen ? 'View your story' : 'Add a story'}
                    aria-label={canOpen ? 'View your story' : 'Add a story'}
                  >
                    <span className="stories-tray-ring">
                      <Avatar name={ring.displayName} avatarUrl={ring.avatarUrl} size="lg" />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="stories-tray-add"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddStory();
                    }}
                    title="Add a story"
                    aria-label="Add a story"
                  >
                    <Icon icon={faPlus} />
                  </button>
                </div>
                <span className="stories-tray-label">Your story</span>
              </div>
            );
          }

          return (
            <button
              key={ring.userId}
              type="button"
              className={`stories-tray-item${ring.hasUnseen ? ' stories-tray-item--unseen' : ''}`}
              onClick={() => {
                if (canOpen) onOpenUser(ring.userId);
              }}
              title={ring.displayName}
              aria-label={`View ${ring.displayName}'s story`}
              disabled={!canOpen}
            >
              <span className="stories-tray-ring">
                <Avatar name={ring.displayName} avatarUrl={ring.avatarUrl} size="lg" />
              </span>
              <span className="stories-tray-label">{ring.displayName}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
