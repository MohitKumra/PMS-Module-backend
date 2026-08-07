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
export type TaskViewPreference = 'board' | 'list';

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
  taskView: TaskViewPreference;
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

export interface AIPreferenceDTO {
  dailyBriefEnabled: boolean;
  journalWeeklyEnabled: boolean;
  insightsEnabled: boolean;
  coachEnabled: boolean;
  journalAnalysisEnabled: boolean;
  goalSummaryEnabled: boolean;
  taskParserEnabled: boolean;
  goalPlannerEnabled: boolean;
  summaryRefreshMinutes: number;

  // ─── Token consumption counters (read-only, set server-side) ──────────
  tokensToday: number;
  tokensThisWeek: number;
  tokensThisMonth: number;
  tokensTotal: number;
  aiCallsTotal: number;
  tokenUsageUpdatedAt: string | null;
}

export interface AISettingsDTO {
  ai: AIPreferenceDTO;
}

export interface UpdateAIPreferencesRequest extends AIPreferenceDTO {}

export interface SettingsDTO {
  appearance: AppearanceSettingsDTO;
  notifications: NotificationPreferenceDTO;
  ai: AIPreferenceDTO;
  integrations: {
    googleCalendar: GoogleCalendarIntegrationDTO;
  };
  security: SecuritySettingsDTO;
}

export interface UpdateAppearanceRequest {
  themePreference?: ThemePreference;
  layoutPreference?: LayoutPreference;
  calendarView?: 'day' | 'week' | 'month' | 'agenda';
  taskView?: TaskViewPreference;
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

// ─── Goals ───────────────────────────────────────────────────────────────────

export type GoalStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
export type GoalPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface GoalDTO {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  color: string;
  targetDate: string | null;
  status: GoalStatus;
  priority: GoalPriority;
  progress: number;
  aiSummary: string | null;
  linkedHabitIds: string[];
  linkedTaskIds: string[];
  linkedProjectIds: string[];
  milestones: GoalMilestoneDTO[];
  habitCount: number;
  taskCount: number;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export type GoalMilestoneStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED';

export interface GoalMilestoneDTO {
  id: string;
  goalId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: GoalMilestoneStatus;
  sortOrder: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGoalMilestoneRequest {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  status?: GoalMilestoneStatus;
  sortOrder?: number;
}

export interface UpdateGoalMilestoneRequest {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  status?: GoalMilestoneStatus;
  sortOrder?: number;
}

export interface CreateGoalRequest {
  title: string;
  description?: string;
  category?: string;
  icon?: string;
  color?: string;
  targetDate?: string | null;
  status?: GoalStatus;
  priority?: GoalPriority;
  aiSummary?: string | null;
  linkedHabitIds?: string[];
  linkedTaskIds?: string[];
  linkedProjectIds?: string[];
}

export interface UpdateGoalRequest {
  title?: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
  color?: string;
  targetDate?: string | null;
  status?: GoalStatus;
  priority?: GoalPriority;
  aiSummary?: string | null;
  linkedHabitIds?: string[];
  linkedTaskIds?: string[];
  linkedProjectIds?: string[];
}

export interface GoalPlannerGoalInput {
  title: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
  color?: string | null;
  targetDate?: string | null;
  status?: GoalStatus;
  priority?: GoalPriority;
}

export interface GoalPlannerMilestoneInput {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  sortOrder?: number;
}

export interface GoalPlannerTaskInput {
  title: string;
  description?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  reminderTime?: string | null;
  reminderMessage?: string | null;
  estimatedDuration?: number | null;
}

export interface GoalPlannerHabitInput {
  title: string;
  reminderTime?: string | null;
  reminderMessage?: string | null;
  targetPerWeek?: number;
}

export interface GoalPlannerProjectInput {
  name: string;
  description?: string | null;
  status?: ProjectStatus;
  color?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface GoalPlannerPlanDTO {
  goal: GoalPlannerGoalInput;
  summary: string;
  milestones: GoalPlannerMilestoneInput[];
  tasks: GoalPlannerTaskInput[];
  habits: GoalPlannerHabitInput[];
  projects: GoalPlannerProjectInput[];
  source: 'ai' | 'fallback';
}

export interface GoalWorkspaceCreateResponse {
  goal: GoalDTO;
  milestones: GoalMilestoneDTO[];
  tasks: TaskDTO[];
  habits: HabitDTO[];
  projects: ProjectDTO[];
  source: 'ai' | 'fallback';
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
  goalId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null; // ISO 8601
  dueTime: string | null; // "HH:mm"
  reminderTime: string | null; // "HH:mm"
  reminderMessage: string | null;
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
  dueTime?: string | null;
  reminderTime?: string | null;
  reminderMessage?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  recurrenceRule?: string;
  recurrenceEndDate?: string;
  skipDates?: string[];
  parentTaskId?: string;
  estimatedDuration?: number | null;
  attachmentUrl?: string | null;
  voiceNoteUrl?: string | null;
  subTasks?: CreateSubTaskRequest[];
  recurrenceConfig?: TaskRecurrenceConfig;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  reminderTime?: string | null;
  reminderMessage?: string | null;
  recurrenceRule?: string | null;
  recurrenceEndDate?: string | null;
  skipDates?: string[];
  attachmentUrl?: string | null;
  voiceNoteUrl?: string | null;
  estimatedDuration?: number | null;
  goalId?: string | null;
  subTasks?: TaskSubTaskInput[];
  recurrenceConfig?: TaskRecurrenceConfig | null;
}

export type TaskRecurrenceFrequency = 'day' | 'week' | 'month' | 'year';
export type TaskRecurrenceEndsType = 'never' | 'date' | 'occurrences';
export type TaskRecurrenceRepeatBasedOn = 'dueDate' | 'completionDate';
export type TaskRecurrenceMissedBehavior = 'skip' | 'overdue' | 'createNext';
export type TaskRecurrenceGenerateNext = 'onCompletion' | 'onDueDate';
export type TaskRecurrenceMonthlyMode = 'dayOfMonth' | 'weekdayPattern';

export interface TaskRecurrenceConfig {
  enabled: boolean;
  frequency: TaskRecurrenceFrequency;
  interval: number;
  weekdays?: string[];
  monthlyMode?: TaskRecurrenceMonthlyMode;
  dayOfMonth?: number | null;
  weekOfMonth?: number | null;
  weekday?: string | null;
  startsAt?: string | null;
  endsType?: TaskRecurrenceEndsType;
  endsAt?: string | null;
  occurrenceCount?: number | null;
  repeatBasedOn?: TaskRecurrenceRepeatBasedOn;
  missedBehavior?: TaskRecurrenceMissedBehavior;
  generateNext?: TaskRecurrenceGenerateNext;
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
  attachments: MediaItemDTO[];
  voiceNotes: MediaItemDTO[];
}

// ─── Habits ──────────────────────────────────────────────────────────────────

export interface HabitDTO {
  id: string;
  userId: string;
  goalId: string | null;
  title: string;
  targetPerWeek: number;
  reminderTime: string | null; // "HH:mm"
  reminderMessage: string | null;
  durationDays: number | null;  // null = forever
  skipDays: number[];           // day indices 0-6 (0=Mon..6=Sun)
  streakBrokenAt: string | null;
  isActive: boolean;
  createdAt: string;
  /** Computed fields (filled by the API) */
  currentStreak: number;
  completedToday: boolean;
  completionsThisWeek: number;
  completionsLastWeek: number;
  bestStreak: number;
  weekPattern: boolean[]; // Mon..Sun
  completionDates: string[];
  streakSafeDays: string[];     // dates that were intentionally skipped
  totalXp: number;              // total XP earned from this habit (15 per completion)
}

export interface CreateHabitRequest {
  title: string;
  reminderTime?: string;
  reminderMessage?: string;
  durationDays?: number | null;  // null = forever
  skipDays?: number[];           // day indices 0-6
  goalId?: string | null;
}

export interface HabitsListResponse {
  data: HabitDTO[];
  meta: {
    total: number;
    weeklyTrend: number;         // real % change vs last week, computed server-side
}
}

export interface HabitStreakBreakDTO {
  habitId: string;
  title: string;
  previousStreak: number;
  xpLost: number;
  brokenAt: string;
}

export interface UpdateHabitRequest {
  title?: string;
  reminderTime?: string | null;
  reminderMessage?: string | null;
  durationDays?: number | null;
  skipDays?: number[];
  goalId?: string | null;
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

export type NoteMood = 'great' | 'good' | 'neutral' | 'bad' | 'awful' | null;

export type NoteSortField = 'updatedAt' | 'createdAt' | 'title';
export type NoteSortOrder = 'asc' | 'desc';

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
  isPinned: boolean;
  mood: NoteMood;
  tags: string[];
  archived: boolean;
  bookmarkPage?: number | null;
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
  mood?: NoteMood;
  tags?: string[];
  bookmarkPage?: number | null;
}

export interface UpdateNoteRequest {
  title?: string | null;
  content?: string;
  isJournal?: boolean;
  taskId?: string | null;
  projectId?: string | null;
  attachmentUrl?: string | null;
  voiceNoteUrl?: string | null;
  isPinned?: boolean;
  mood?: NoteMood;
  tags?: string[];
  archived?: boolean;
  bookmarkPage?: number | null;
}

export interface NoteListFilters {
  isJournal?: boolean;
  taskId?: string;
  projectId?: string;
  search?: string;
  tags?: string[];
  mood?: NoteMood;
  dateFrom?: string;   // ISO date
  dateTo?: string;     // ISO date
  archived?: boolean;
  isPinned?: boolean;
  sortField?: NoteSortField;
  sortOrder?: NoteSortOrder;
  page?: number;
  limit?: number;
}

// ─── Focus Sessions ──────────────────────────────────────────────────────────

export type FocusSessionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface FocusSessionDTO {
  id: string;
  userId: string;
  durationMin: number;
  elapsedMin: number;
  startedAt: string;
  status: FocusSessionStatus;
  completedAt: string | null;
  taskId: string | null;
  projectId: string | null;
  isBreak: boolean;
}

export interface CreateFocusSessionRequest {
  durationMin: number;
  taskId?: string | null;
  projectId?: string | null;
  isBreak?: boolean;
}

export interface UpdateFocusSessionRequest {
  elapsedMin: number;
  status?: FocusSessionStatus;
}

// ─── Focus Time Logs ─────────────────────────────────────────────────────────

export interface FocusTimeLogDTO {
  id: string;
  userId: string;
  durationMin: number;
  date: string;
}

export interface CreateFocusTimeLogRequest {
  durationMin: number;
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
  overdueTasks: number;
  cancelledFocusSessions: number;
  missedHabitsToday: number;
  longestHabitStreak: number;
  currentHabitStreak: number; // Current active streak (not broken)
  productivityScore: number; // 0-100 productivity score
}

export interface DailyAnalyticsDTO {
  date: string; // "YYYY-MM-DD"
  tasksCreated: number;
  tasksCompleted: number;
  tasksOverdue: number;
  focusMinutes: number;
  habitsCompleted: number;
  productivityScore: number;
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

export interface AchievementWithStatusDTO {
  key: string;
  title: string;
  description: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  icon: string;
  pointsAwarded: number;
  isUnlocked: boolean;
  unlockedAt: string | null;
  progress: number; // 0-100 percentage toward unlock
  progressCurrent: number; // current value
  progressTarget: number; // target value
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
    totalActionable: number;
    totalActivity: number;
  };
}

// ─── Project Media (multiple attachments / voice notes) ──────────────────────

export interface MediaItemDTO {
  id: string;
  url: string;
  type: 'attachment' | 'voice_note';
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
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
  goalId: string | null;
  startDate: string | null;
  dueDate: string | null;
  attachmentUrl: string | null;
  voiceNoteUrl: string | null;
  attachments: MediaItemDTO[];
  voiceNotes: MediaItemDTO[];
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
  goalId?: string | null;
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
  goalId?: string | null;
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
  expectedProgress: number;
  progressDelta: number;
  health: 'AHEAD' | 'ON_TRACK' | 'BEHIND';
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  focusMinutes: number;
  daysRemaining: number | null;
  expectedFinish: string | null;
  actualFinish: string | null;
  weeklyProgress: Array<{
    week: string;
    tasksCompleted: number;
  }>;
}

export type InsightType = 'positive' | 'neutral' | 'warning';
export type InsightIcon = 'trend' | 'clock' | 'calendar' | 'alert';

export interface InsightDTO {
  id: string;
  type: InsightType;
  icon: InsightIcon;
  text: string;
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
  insights: InsightDTO[];
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