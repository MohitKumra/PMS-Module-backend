// backend/src/services/ai/context/contextRanker.ts
// Deterministic task relevance ranking (spec §27, §29). The backend scores ALL
// open candidate tasks and hands the LLM only the strongest top-N candidates
// — the model reasons, it never searches the whole database.

const PRIORITY_POINTS: Record<string, number> = { CRITICAL: 50, HIGH: 35, MEDIUM: 15, LOW: 0 };

export interface RecommendableTask {
  id: string;
  title: string;
  priority?: string | null;
  status?: string | null;
  dueDate?: string | null;
  estimatedDuration?: number | null;
  goalId?: string | null;
  /** true when the task is associated with a pending milestone/active goal */
  milestoneRelevant?: boolean;
  updatedAt?: string | null;
}

export interface RecommendationCandidate extends RecommendableTask {
  score: number;
  reasons: string[];
}

export interface RankOptions {
  /** Today key YYYY-MM-DD (defaults to UTC today). */
  today?: string;
  /** Active goal id — boosts tasks linked to it. */
  activeGoalId?: string | null;
  /** Emphasise tasks linked to a specific goal (e.g. startup goal). */
  preferGoalId?: string | null;
  /** Entities to exclude (negation), spec §44. */
  excludedEntityIds?: string[];
  /** Available time in minutes, spec §34. */
  effortMinutes?: number | null;
  /** Boost tasks that match the current contextMatch score 0..30. */
  contextMatches?: Record<string, number>;
  /** Per-dimension weight multipliers (configurable). */
  weights?: Partial<RecommendationWeights>;
  /** How many candidates to return (default 4). */
  limit?: number;
  /** Ranking emphasis ("today" | "next" | "effort" | "goal" | "default"). */
  mode?: 'today' | 'next' | 'effort' | 'goal' | 'default';
}

export interface RecommendationWeights {
  priority: number;
  overdue: number;
  urgency: number;
  goalAlignment: number;
  milestone: number;
  recency: number;
  effort: number;
  context: number;
}

const DEFAULT_WEIGHTS: RecommendationWeights = {
  priority: 1,
  overdue: 1,
  urgency: 1,
  goalAlignment: 1,
  milestone: 1,
  recency: 1,
  effort: 1,
  context: 1,
};
function toDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function daysFrom(dateKey: string, todayKey: string): number {
  const [y1, m1, d1] = dateKey.split('-').map(Number);
  const [y2, m2, d2] = todayKey.split('-').map(Number);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
}

function utcTodayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function isOpen(status?: string | null): boolean {
  return status === 'TODO' || status === 'IN_PROGRESS' || status == null;
}

/**
 * Score each open task deterministically and return the top-N candidates.
 * Excluded entities are dropped before scoring. Effort constraints push
 * tasks that do not fit to the bottom.
 */
export function rankTasks(tasks: RecommendableTask[], options: RankOptions = {}): RecommendationCandidate[] {
  const today = options.today ?? utcTodayKey();
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const excluded = new Set(options.excludedEntityIds ?? []);
  const contextMatches = options.contextMatches ?? {};
  const effort = options.effortMinutes ?? null;

  const scored: RecommendationCandidate[] = [];

  for (const task of tasks) {
    if (excluded.has(task.id)) continue;
    if (!isOpen(task.status)) continue;

    const dueKey = toDateKey(task.dueDate);
    const overdue = Boolean(dueKey && daysFrom(dueKey, today) < 0);
    const dueToday = Boolean(dueKey && dueKey === today);
    const dueTomorrow = Boolean(dueKey && daysFrom(dueKey, today) === 1);
    const dueThisWeek = Boolean(dueKey && !overdue && daysFrom(dueKey, today) > 0 && daysFrom(dueKey, today) <= 7);

    const priority = (task.priority ?? 'MEDIUM').toUpperCase();
    const points: Record<keyof RecommendationWeights, number> = {
      priority: PRIORITY_POINTS[priority] ?? 10,
      overdue: overdue ? 55 : 0,
      urgency: dueToday ? 45 : dueTomorrow ? 30 : dueThisWeek ? 18 : 0,
      goalAlignment:
        task.goalId != null && (options.activeGoalId == null || task.goalId === options.activeGoalId)
          ? 25
          : options.preferGoalId && task.goalId === options.preferGoalId
            ? 30
            : 0,
      milestone: task.milestoneRelevant ? 15 : 0,
      recency: recencyPoints(task.updatedAt),
      effort: effort == null ? 0 : task.estimatedDuration == null || task.estimatedDuration <= effort ? 18 : -60,
      context: contextMatches[task.id] ?? 0,
    };

    const score =
      points.priority * weights.priority +
      points.overdue * weights.overdue +
      points.urgency * weights.urgency +
      points.goalAlignment * weights.goalAlignment +
      points.milestone * weights.milestone +
      points.recency * weights.recency +
      points.effort * weights.effort +
      points.context * weights.context;

    scored.push({
      ...task,
      score,
      reasons: buildReasons(task, points, effort, dueToday),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, options.limit ?? 4);
}

function recencyPoints(updatedAt?: string | null): number {
  if (!updatedAt) return 0;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  const days = (Date.now() - t) / 86400000;
  if (days < 1) return 10;
  if (days < 3) return 6;
  if (days < 7) return 3;
  return 0;
}

function buildReasons(
  task: RecommendableTask,
  points: Record<keyof RecommendationWeights, number>,
  effort: number | null,
  dueToday: boolean,
): string[] {
  const reasons: string[] = [];
  const priority = (task.priority ?? 'MEDIUM').toUpperCase();
  if (priority === 'HIGH' || priority === 'CRITICAL') reasons.push(`${priority} priority`);
  if (points.overdue > 0) reasons.push('overdue');
  if (dueToday) reasons.push('due today');
  if (points.goalAlignment > 0) reasons.push('linked to an active goal');
  if (points.milestone > 0) reasons.push('supports a milestone');
  if (effort != null && points.effort > 0) reasons.push(`fits your ${effort}-minute window`);
  return reasons.slice(0, 4);
}