import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, TaskItem, TaskStatusFilter, User } from '../services/api';
import { realtime } from '../services/realtime';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { AssigneePicker } from './AssigneePicker';
import { ConfirmModal } from './ConfirmModal';
import { CreateTaskModal, CreateTaskInput } from './CreateTaskModal';
import {
  faArrowLeft,
  faCheck,
  faPlus,
  faTrashCan,
  faUserPen,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

interface Props {
  onClose: () => void;
  isMobile?: boolean;
  conversationId?: string | null;
  onBadgeChange?: () => void;
}

const FILTERS: Array<{ id: TaskStatusFilter; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'pending', label: 'Pending' },
  { id: 'completed', label: 'Completed' },
  { id: 'all', label: 'All' },
];

function formatDueDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isToday) {
    return `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isOverdue(task: TaskItem): boolean {
  if (task.completed || !task.dueAt) return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

function displayName(user: { displayName?: string; username?: string } | null | undefined) {
  return user?.displayName || user?.username || null;
}

export function TasksPanel({
  onClose,
  isMobile = false,
  conversationId = null,
  onBadgeChange,
}: Props) {
  const { user } = useAuth();
  const [filter, setFilter] = useState<TaskStatusFilter>('open');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [reassigningTaskId, setReassigningTaskId] = useState<string | null>(null);
  const [reassignDraftId, setReassignDraftId] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState<TaskItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const closeLabel = isMobile ? 'Back to conversations' : 'Close tasks';

  const loadTasks = useCallback(
    async (status: TaskStatusFilter) => {
      setLoading(true);
      setError('');
      try {
        const list = await api.listTasks({
          status,
          conversationId: conversationId ?? undefined,
        });
        setTasks(list);
        if (status === 'pending') {
          setPendingCount(list.length);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tasks');
        setTasks([]);
      } finally {
        setLoading(false);
      }
    },
    [conversationId],
  );

  const refreshPendingCount = useCallback(async () => {
    try {
      const list = await api.listTasks({
        status: 'pending',
        conversationId: conversationId ?? undefined,
      });
      setPendingCount(list.length);
    } catch {
      // Keep last known count.
    }
  }, [conversationId]);

  useEffect(() => {
    void loadTasks(filter);
  }, [filter, loadTasks]);

  useEffect(() => {
    void refreshPendingCount();
  }, [refreshPendingCount]);

  const taskBelongsInFilter = useCallback(
    (task: TaskItem, activeFilter: TaskStatusFilter) => {
      if (!user) return false;
      const isCreator = task.createdBy.id === user.id;
      const isAssignee = task.assignedTo?.id === user.id;
      const isPendingForMe = task.pendingAssignee?.id === user.id;

      if (conversationId && task.conversationId !== conversationId) return false;

      if (activeFilter === 'pending') {
        return isPendingForMe && !task.completed;
      }
      if (activeFilter === 'open') {
        return !task.completed && (isCreator || isAssignee);
      }
      if (activeFilter === 'completed') {
        return task.completed && (isCreator || isAssignee);
      }
      // all
      return isCreator || isAssignee || isPendingForMe;
    },
    [conversationId, user],
  );

  useEffect(() => {
    if (!user) return;

    const unsubUpdated = realtime.onTaskUpdated((incoming) => {
      // Tasks tab is open: pending invites are treated as read (badge refresh marks seen).
      const task: TaskItem = {
        ...incoming,
        isUnread: false,
      };
      setTasks((prev) => {
        const belongs = taskBelongsInFilter(task, filter);
        const exists = prev.some((item) => item.id === task.id);
        if (!belongs) {
          return exists ? prev.filter((item) => item.id !== task.id) : prev;
        }
        if (!exists) return [task, ...prev];
        return prev.map((item) => (item.id === task.id ? task : item));
      });
      void refreshPendingCount();
      onBadgeChange?.();
    });

    const unsubDeleted = realtime.onTaskDeleted(({ taskId }) => {
      setTasks((prev) => prev.filter((item) => item.id !== taskId));
      void refreshPendingCount();
      onBadgeChange?.();
    });

    return () => {
      unsubUpdated();
      unsubDeleted();
    };
  }, [filter, onBadgeChange, refreshPendingCount, taskBelongsInFilter, user]);

  const openCount = useMemo(
    () => tasks.filter((task) => !task.completed).length,
    [tasks],
  );

  const handleCreate = async (input: CreateTaskInput) => {
    setCreateBusy(true);
    setCreateError('');
    try {
      await api.createTask({
        ...input,
        conversationId: conversationId ?? undefined,
      });
      setShowCreate(false);
      await loadTasks(filter);
      void refreshPendingCount();
      onBadgeChange?.();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreateBusy(false);
    }
  };

  const handleToggleComplete = async (task: TaskItem) => {
    setActionId(task.id);
    setError('');
    try {
      const updated = await api.updateTask(task.id, { completed: !task.completed });
      setTasks((prev) => {
        if (!taskBelongsInFilter(updated, filter)) {
          return prev.filter((item) => item.id !== updated.id);
        }
        return prev.map((item) => (item.id === updated.id ? updated : item));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
    } finally {
      setActionId(null);
    }
  };

  const handleDueDateChange = async (task: TaskItem, value: string) => {
    setActionId(task.id);
    setError('');
    try {
      const dueAt = value.trim() ? new Date(value).toISOString() : null;
      if (value.trim() && Number.isNaN(new Date(value).getTime())) {
        throw new Error('Invalid due date');
      }
      const updated = await api.updateTask(task.id, { dueAt });
      setTasks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update due date');
    } finally {
      setActionId(null);
    }
  };

  const openReassign = (task: TaskItem) => {
    setReassigningTaskId(task.id);
    setReassignDraftId(task.pendingAssignee?.id ?? task.assignedTo?.id ?? null);
    setError('');
  };

  const handleSaveReassign = async (task: TaskItem) => {
    setActionId(task.id);
    setError('');
    try {
      const updated = await api.assignTask(
        task.id,
        reassignDraftId,
        task.assignmentVersion,
      );
      setTasks((prev) => {
        if (!taskBelongsInFilter(updated, filter)) {
          return prev.filter((item) => item.id !== updated.id);
        }
        return prev.map((item) => (item.id === updated.id ? updated : item));
      });
      setReassigningTaskId(null);
      void refreshPendingCount();
      onBadgeChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reassign task');
    } finally {
      setActionId(null);
    }
  };

  const handleAccept = async (task: TaskItem) => {
    setActionId(task.id);
    setError('');
    try {
      const updated = await api.acceptTask(task.id, task.assignmentVersion);
      setTasks((prev) => {
        if (!taskBelongsInFilter(updated, filter)) {
          return prev.filter((item) => item.id !== updated.id);
        }
        return prev.map((item) => (item.id === updated.id ? updated : item));
      });
      // If accepted while on Pending filter, switch to Open so the task is visible.
      if (filter === 'pending') {
        setFilter('open');
      }
      void refreshPendingCount();
      onBadgeChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept task');
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (task: TaskItem) => {
    setActionId(task.id);
    setError('');
    try {
      await api.rejectTask(task.id, task.assignmentVersion);
      setTasks((prev) => prev.filter((item) => item.id !== task.id));
      void refreshPendingCount();
      onBadgeChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject task');
    } finally {
      setActionId(null);
    }
  };

  const handleCancelPending = async (task: TaskItem) => {
    setActionId(task.id);
    setError('');
    try {
      const updated = await api.cancelTaskAssignment(task.id);
      setTasks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      void refreshPendingCount();
      onBadgeChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel assignment');
    } finally {
      setActionId(null);
    }
  };

  const handleDeleteTask = async () => {
    if (!deletingTask) return;
    setDeleteBusy(true);
    setError('');
    try {
      await api.deleteTask(deletingTask.id);
      setTasks((prev) => prev.filter((item) => item.id !== deletingTask.id));
      setDeletingTask(null);
      if (reassigningTaskId === deletingTask.id) {
        setReassigningTaskId(null);
      }
      void refreshPendingCount();
      onBadgeChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="tasks-panel">
      <header className="profile-header">
        <button
          className="icon-btn close-chat-btn"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
        >
          {isMobile ? <Icon icon={faArrowLeft} /> : <Icon icon={faXmark} />}
        </button>
        <h3>Tasks</h3>
        <button
          type="button"
          className="icon-btn tasks-add-btn"
          onClick={() => {
            setCreateError('');
            setShowCreate(true);
          }}
          aria-label="Add task"
          title="Add task"
        >
          <Icon icon={faPlus} />
        </button>
      </header>

      <div className="tasks-filter-bar" role="tablist" aria-label="Task filters">
        {FILTERS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={filter === tab.id}
            className={`tasks-filter-btn${filter === tab.id ? ' active' : ''}`}
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
            {tab.id === 'open' && filter === 'open' && openCount > 0
              ? ` (${openCount})`
              : ''}
            {tab.id === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      <div className="tasks-content">
        {error && <p className="profile-error-inline">{error}</p>}

        {loading ? (
          <p className="contacts-hint">Loading tasks...</p>
        ) : tasks.length === 0 ? (
          <div className="contacts-empty">
            <p>
              {filter === 'pending' ? 'No pending invitations' : 'No tasks yet'}
            </p>
            <span>
              {filter === 'pending'
                ? 'Assignments from other people will appear here until you accept'
                : 'Add one manually or convert a message to a task'}
            </span>
            {filter !== 'pending' && (
              <button
                type="button"
                className="contact-action-btn primary"
                onClick={() => setShowCreate(true)}
              >
                Add task
              </button>
            )}
          </div>
        ) : (
          <ul className="tasks-list">
            {tasks.map((task) => {
              const busy = actionId === task.id;
              const dueLabel = formatDueDate(task.dueAt);
              const overdue = isOverdue(task);
              const assigneeName = displayName(task.assignedTo);
              const pendingName = displayName(task.pendingAssignee);
              const canDelete = task.createdBy.id === user?.id;
              const canAssign = task.createdBy.id === user?.id && !task.completed;
              const isPendingForMe =
                task.pendingAssignee?.id === user?.id && !task.completed;
              const isReassigning = reassigningTaskId === task.id;

              return (
                <li
                  key={task.id}
                  className={`task-row${task.completed ? ' task-row--done' : ''}${
                    task.isUnread ? ' task-row--unread' : ''
                  }`}
                >
                  {!isPendingForMe && (
                    <button
                      type="button"
                      className={`task-complete-btn${task.completed ? ' active' : ''}`}
                      onClick={() => void handleToggleComplete(task)}
                      disabled={busy}
                      aria-label={task.completed ? 'Mark as open' : 'Mark as completed'}
                      title={task.completed ? 'Mark as open' : 'Mark completed'}
                    >
                      <Icon icon={faCheck} />
                    </button>
                  )}

                  <div className="task-row-body">
                    <div className="task-title-row">
                      <span className="task-title">{task.title}</span>
                      {task.assignmentStatus === 'pending' && (
                        <span className="task-pending-badge">Pending</span>
                      )}
                    </div>
                    {task.description && (
                      <p className="task-description">{task.description}</p>
                    )}
                    <div className="task-meta">
                      {pendingName ? (
                        <span className="task-assignee task-assignee--pending">
                          <Avatar
                            name={pendingName}
                            avatarUrl={task.pendingAssignee?.avatarUrl}
                            size="sm"
                          />
                          Waiting for {pendingName}
                        </span>
                      ) : assigneeName ? (
                        <span className="task-assignee">
                          <Avatar
                            name={assigneeName}
                            avatarUrl={task.assignedTo?.avatarUrl}
                            size="sm"
                          />
                          {assigneeName}
                        </span>
                      ) : (
                        <span className="task-meta-muted">Unassigned</span>
                      )}
                      {dueLabel && (
                        <span className={`task-due${overdue ? ' task-due--overdue' : ''}`}>
                          Due {dueLabel}
                        </span>
                      )}
                      {task.sourceMessageId && (
                        <span className="task-meta-muted">From message</span>
                      )}
                    </div>

                    {isPendingForMe ? (
                      <div className="task-row-actions">
                        <button
                          type="button"
                          className="contact-action-btn primary"
                          onClick={() => void handleAccept(task)}
                          disabled={busy}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="contact-action-btn"
                          onClick={() => void handleReject(task)}
                          disabled={busy}
                        >
                          Reject
                        </button>
                      </div>
                    ) : isReassigning ? (
                      <div className="task-reassign-panel">
                        <span className="task-reassign-label">Assign to</span>
                        <AssigneePicker
                          selectedId={reassignDraftId}
                          onSelect={setReassignDraftId}
                          disabled={busy}
                          excludeUserId={user?.id}
                          seedUsers={
                            (task.pendingAssignee ?? task.assignedTo)?.displayName ||
                            (task.pendingAssignee ?? task.assignedTo)?.username
                              ? [(task.pendingAssignee ?? task.assignedTo) as User]
                              : []
                          }
                        />
                        <div className="task-row-actions">
                          <button
                            type="button"
                            className="contact-action-btn"
                            onClick={() => setReassigningTaskId(null)}
                            disabled={busy}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="contact-action-btn primary"
                            onClick={() => void handleSaveReassign(task)}
                            disabled={busy}
                          >
                            {busy ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="task-row-actions">
                        {canAssign && (
                          <button
                            type="button"
                            className="contact-action-btn"
                            onClick={() => openReassign(task)}
                            disabled={busy}
                            title={
                              pendingName || assigneeName
                                ? 'Reassign task'
                                : 'Assign task'
                            }
                          >
                            <Icon icon={faUserPen} />
                            {pendingName || assigneeName ? 'Reassign' : 'Assign'}
                          </button>
                        )}
                        {canAssign && task.pendingAssignee && (
                          <button
                            type="button"
                            className="contact-action-btn"
                            onClick={() => void handleCancelPending(task)}
                            disabled={busy}
                          >
                            Cancel invite
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="contact-action-btn task-delete-btn"
                            onClick={() => setDeletingTask(task)}
                            disabled={busy}
                            title="Delete task"
                            aria-label="Delete task"
                          >
                            <Icon icon={faTrashCan} />
                            Delete
                          </button>
                        )}
                      </div>
                    )}

                    {!task.completed &&
                      !isReassigning &&
                      !isPendingForMe &&
                      (canAssign || task.assignedTo?.id === user?.id) && (
                      <label className="task-due-edit">
                        <span>Due date</span>
                        <input
                          type="datetime-local"
                          disabled={busy}
                          value={
                            task.dueAt
                              ? (() => {
                                  const d = new Date(task.dueAt);
                                  const pad = (n: number) => String(n).padStart(2, '0');
                                  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                                })()
                              : ''
                          }
                          onChange={(e) => void handleDueDateChange(task, e.target.value)}
                        />
                      </label>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <CreateTaskModal
        open={showCreate}
        busy={createBusy}
        error={createError}
        onClose={() => {
          if (!createBusy) setShowCreate(false);
        }}
        onSubmit={handleCreate}
      />

      <ConfirmModal
        open={Boolean(deletingTask)}
        title="Delete task?"
        message={
          deletingTask
            ? `Delete "${deletingTask.title}"? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
        onConfirm={() => void handleDeleteTask()}
        onCancel={() => {
          if (!deleteBusy) setDeletingTask(null);
        }}
      />
    </div>
  );
}
