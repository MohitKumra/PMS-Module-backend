/**
 * backend/src/types/index.ts
 * TypeScript DTOs used by backend.
 */

// ─── User ───────────────────────────────────────────────────────────────────

/** Public user shape returned by the API (no passwordHash, no tokens). */
export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  timezone: string;
  createdAt: string; // ISO 8601
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  email: string;
  password: string;
  name?: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserDTO;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH';

/** Full task shape returned by the API. */
export interface TaskDTO {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null; // ISO 8601
  recurrenceRule: string | null; // RRULE string
  parentTaskId: string | null;
  attachmentUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  priority?: Priority;
  dueDate?: string;
  recurrenceRule?: string;
  parentTaskId?: string;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  dueDate?: string | null;
  recurrenceRule?: string | null;
  attachmentUrl?: string | null;
}

// ─── Habits ──────────────────────────────────────────────────────────────────

export interface HabitDTO {
  id: string;
  userId: string;
  title: string;
  targetPerWeek: number;
  reminderTime: string | null; // "HH:mm"
  createdAt: string;
  /** Computed fields (filled by the API) */
  currentStreak: number;
  completedToday: boolean;
  completionsThisWeek: number;
}

export interface CreateHabitRequest {
  title: string;
  targetPerWeek?: number;
  reminderTime?: string;
}

export interface UpdateHabitRequest {
  title?: string;
  targetPerWeek?: number;
  reminderTime?: string | null;
}

// ─── Habit Completions ────────────────────────────────────────────────────────

export interface HabitCompletionDTO {
  id: string;
  habitId: string;
  date: string; // "YYYY-MM-DD"
  createdAt: string;
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export interface NoteDTO {
  id: string;
  userId: string;
  title: string | null;
  content: string;
  isJournal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteRequest {
  title?: string;
  content: string;
  isJournal?: boolean;
}

export interface UpdateNoteRequest {
  title?: string | null;
  content?: string;
  isJournal?: boolean;
}

// ─── Focus Sessions ──────────────────────────────────────────────────────────

export interface FocusSessionDTO {
  id: string;
  userId: string;
  durationMin: number;
  startedAt: string;
  completed: boolean;
}

export interface CreateFocusSessionRequest {
  durationMin: number;
  startedAt: string;
  completed: boolean;
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface AnalyticsSummaryDTO {
  tasksCompleted: number;
  tasksTotal: number;
  taskCompletionRate: number; // 0-100
  habitsCompletedToday: number;
  habitsTotal: number;
  focusMinutesTotal: number;
  focusSessionsTotal: number;
  longestHabitStreak: number;
}

export interface DailyAnalyticsDTO {
  date: string; // "YYYY-MM-DD"
  tasksCompleted: number;
  focusMinutes: number;
  habitsCompleted: number;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export type NotificationChannel = 'BROWSER_PUSH' | 'EMAIL' | 'NATIVE_LOCAL';

export interface NotificationLogDTO {
  id: string;
  userId: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  sentAt: string;
  readAt: string | null;
}

export interface PushSubscriptionRequest {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// ─── API Envelope ─────────────────────────────────────────────────────────────

/** Standard list response envelope. */
export interface ListResponse<T> {
  data: T[];
  meta: { total: number };
}

/** Standard error envelope. */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
