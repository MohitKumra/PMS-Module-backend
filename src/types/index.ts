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
  recoveryEmail: string | null;
  timezone: string;
  hasPassword: boolean;
  hasGoogle: boolean;
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

export type ThemePreference = 'LIGHT' | 'DARK' | 'SYSTEM';
export type LayoutPreference = 'COMFORTABLE' | 'COMPACT' | 'EXPANDED';

export interface NotificationPreferenceDTO {
  taskDue: boolean;
  habitReminder: boolean;
  projectDeadline: boolean;
  focusSessionComplete: boolean;
  calendarSync: boolean;
}

export interface AppearanceSettingsDTO {
  themePreference: ThemePreference;
  layoutPreference: LayoutPreference;
  calendarView: 'day' | 'week' | 'month' | 'agenda';
}

export interface GoogleCalendarIntegrationDTO {
  connected: boolean;
  googleEmail: string | null;
  calendarId: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  isActive: boolean;
  syncTasks: boolean;
}

export interface SecuritySettingsDTO {
  hasPassword: boolean;
  hasGoogle: boolean;
  recoveryEmail: string | null;
}

export interface SettingsDTO {
  appearance: AppearanceSettingsDTO;
  notifications: NotificationPreferenceDTO;
  integrations: {
    googleCalendar: GoogleCalendarIntegrationDTO;
  };
  security: SecuritySettingsDTO;
}

export interface UpdateAppearanceRequest {
  themePreference?: ThemePreference;
  layoutPreference?: LayoutPreference;
  calendarView?: 'day' | 'week' | 'month' | 'agenda';
}

export interface UpdateNotificationPreferencesRequest extends NotificationPreferenceDTO {}

export interface UpdateRecoveryEmailRequest {
  recoveryEmail: string | null;
}

export interface ChangePasswordRequest {
  currentPassword?: string;
  newPassword: string;
}

export interface SetPasswordRequest {
  newPassword: string;
}

export interface GoogleAuthStartResponse {
  url: string;
}

export type GoogleAuthPurpose = 'signin' | 'calendar-connect';

export interface GoogleCalendarSyncResponse {
  synced: number;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export type TaskStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'CANCELLED';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ─── SubTasks ──────────────────────────────────────────────────────────────────

export interface SubTaskDTO {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubTaskRequest {
  title: string;
  order?: number;
}

export interface TaskSubTaskInput {
  id?: string;
  title: string;
  order?: number;
  completed?: boolean;
}

export interface UpdateSubTaskRequest {
  title?: string;
  completed?: boolean;
  order?: number;
}

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
  recurrenceEndDate: string | null; // ISO 8601
  skipDates: string[]; // YYYY-MM-DD
  parentTaskId: string | null;
  attachmentUrl: string | null;
  voiceNoteUrl: string | null;
  inProgressAt: string | null;
  completedAt: string | null;
  estimatedDuration: number | null; // minutes
  project?: {
    id: string;
    name: string;
    color: string | null;
  } | null;
  subTasks?: SubTaskDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  dueDate?: string;
  recurrenceRule?: string;
  recurrenceEndDate?: string;
  skipDates?: string[];
  parentTaskId?: string;
  estimatedDuration?: number | null;
  attachmentUrl?: string | null;
  voiceNoteUrl?: string | null;
  subTasks?: CreateSubTaskRequest[];
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  dueDate?: string | null;
  recurrenceRule?: string | null;
  recurrenceEndDate?: string | null;
  skipDates?: string[];
  attachmentUrl?: string | null;
  voiceNoteUrl?: string | null;
  estimatedDuration?: number | null;
  subTasks?: TaskSubTaskInput[];
}

export interface TaskActivityDTO {
  id: string;
  taskId: string;
  userId: string;
  type: string;
  content: string;
  createdAt: string;
}

export interface CreateTaskTimeEntryRequest {
  minutes: number;
  note?: string;
  startedAt?: string;
}

export interface TaskTimeEntryDTO {
  id: string;
  taskId: string;
  userId: string;
  minutes: number;
  note: string | null;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetailDTO extends TaskDTO {
  activity: TaskActivityDTO[];
  timeEntries: TaskTimeEntryDTO[];
  linkedNotes: NoteDTO[];
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
  completionsLastWeek: number;
  bestStreak: number;
  weekPattern: boolean[]; // Mon..Sun
  completionDates: string[];
}

export interface CreateHabitRequest {
  title: string;
  targetPerWeek?: number;
  reminderTime?: string;
}

export interface HabitsListResponse {
  data: HabitDTO[];
  meta: {
    total: number;
    weeklyTrend: number;         // real % change vs last week, computed server-side
}
}

export interface UpdateHabitRequest {
  title?: string;
  targetPerWeek?: number;
  reminderTime?: string | null;
}

// ─── Week Overview ────────────────────────────────────────────────────────────

export interface WeekDayDTO {
  date: string;   // "YYYY-MM-DD"
  score: number;  // 0-100
  completed: number;
  total: number;
  isFuture: boolean;
  isToday: boolean;
}

export interface WeekOverviewDTO {
  days: WeekDayDTO[];
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
  taskId: string | null;
  projectId: string | null;
  attachmentUrl: string | null;
  voiceNoteUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteRequest {
  title?: string;
  content: string;
  isJournal?: boolean;
  taskId?: string | null;
  projectId?: string | null;
  attachmentUrl?: string | null;
  voiceNoteUrl?: string | null;
}

export interface UpdateNoteRequest {
  title?: string | null;
  content?: string;
  isJournal?: boolean;
  taskId?: string | null;
  projectId?: string | null;
  attachmentUrl?: string | null;
  voiceNoteUrl?: string | null;
}

// ─── Focus Sessions ──────────────────────────────────────────────────────────

export interface FocusSessionDTO {
  id: string;
  userId: string;
  durationMin: number;
  startedAt: string;
  completed: boolean;
  taskId: string | null;
  isBreak: boolean;
}

export interface CreateFocusSessionRequest {
  durationMin: number;
  startedAt: string;
  completed: boolean;
  taskId?: string | null;
  isBreak?: boolean;
}

// ─── Calendar ────────────────────────────────────────────────────────────────

export type CalendarEventType = 'TASK_DUE' | 'FOCUS_SESSION';

export interface CalendarEventDTO {
  id: string;
  type: CalendarEventType;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  taskId: string | null;
  priority: Priority | null;
  status: TaskStatus | null;
  sourceLabel: string;
  metadata?: {
    durationMin?: number;
    description?: string | null;
  };
}

export interface CalendarOverviewDTO {
  range: {
    from: string;
    to: string;
  };
  events: CalendarEventDTO[];
  meta: {
    totalEvents: number;
    taskEvents: number;
    focusEvents: number;
  };
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
  currentHabitStreak: number; // Current active streak (not broken)
  productivityScore: number; // 0-100 productivity score
}

export interface DailyAnalyticsDTO {
  date: string; // "YYYY-MM-DD"
  tasksCompleted: number;
  focusMinutes: number;
  habitsCompleted: number;
}

// ─── Gamification ─────────────────────────────────────────────────────────

export interface PointLedgerDTO {
  id: string;
  points: number;
  reason: string;
  entityType: string;
  entityId: string;
  description: string;
  createdAt: string;
}

export interface AchievementDTO {
  id: string;
  key: string;
  title: string;
  description: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  icon: string;
  pointsAwarded: number;
  unlockedAt: string;
}

export interface GamificationProfileDTO {
  totalPoints: number;
  level: number;
  currentLevelPoints: number;
  nextLevelPoints: number;
  progressPercent: number;
  achievements: AchievementDTO[];
  recentAchievements: AchievementDTO[];
  recentPoints: PointLedgerDTO[];
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

// ─── In-App Activity Feed ─────────────────────────────────────────────────────

export type InAppNotificationType =
  | 'TASK_CREATED' | 'TASK_COMPLETED' | 'TASK_STATUS_CHANGED'
  | 'HABIT_COMPLETED' | 'HABIT_STREAK'
  | 'FOCUS_SESSION_COMPLETED'
  | 'PROJECT_CREATED' | 'PROJECT_COMPLETED' | 'PROJECT_STATUS_CHANGED'
  | 'TASK_OVERDUE' | 'TASK_DUE_SOON' | 'HABIT_PENDING';

export interface InAppNotificationDTO {
  id: string;
  type: InAppNotificationType;
  title: string;
  description?: string;
  timestamp: string;
  entityType: 'task' | 'habit' | 'project' | 'focus';
  entityId: string;
  metadata?: Record<string, any>;
  isActionable: boolean; // true for overdue/pending items
}

export interface ActivityFeedResponse {
  data: InAppNotificationDTO[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
    nextCursor?: string;
  };
}

// ─── Projects (Individual) ────────────────────────────────────────────────────

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';

export interface ProjectDTO {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  color: string;
  userId: string;
  startDate: string | null;
  dueDate: string | null;
  attachmentUrl: string | null;
  voiceNoteUrl: string | null;
  progress: number; // 0-100
  createdAt: string;
  updatedAt: string;
  taskCount?: number;
  completedTaskCount?: number;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  status?: ProjectStatus;
  color?: string;
  startDate?: string;
  dueDate?: string;
  attachmentUrl?: string | null;
  voiceNoteUrl?: string | null;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  color?: string;
  startDate?: string | null;
  dueDate?: string | null;
  attachmentUrl?: string | null;
  voiceNoteUrl?: string | null;
  progress?: number;
}

export interface AssignTaskToProjectRequest {
  taskId: string;
  order?: number;
}

// ─── Enhanced Analytics (Individual Focus) ────────────────────────────────────

export interface ProjectAnalyticsDTO {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
  progress: number;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  daysRemaining: number | null;
  weeklyProgress: Array<{
    week: string;
    tasksCompleted: number;
  }>;
}

export interface EnhancedDashboardDTO extends AnalyticsSummaryDTO {
  gamification: GamificationProfileDTO;
  activeProjects: ProjectDTO[];
  projectStats: {
    totalProjects: number;
    activeProjectsCount: number;
    completedProjectsCount: number;
  };
  weeklyProgress: {
    week: string; // "YYYY-WW"
    tasksCompleted: number;
    focusMinutes: number;
    habitsCompleted: number;
    projectsCompleted: number;
  }[];
  upcomingDeadlines: Array<{
    type: 'task' | 'project';
    id: string;
    title: string;
    dueDate: string;
    daysUntilDue: number;
  }>;
}

// ─── API Envelope ─────────────────────────────────────────────────────────────

/** Standard list response envelope. */
export interface ListResponse<T> {
  data: T[];
  meta: { total: number; nextCursor?: string | null };
}

/** Standard error envelope. */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
