// backend/src/services/ai/entity/entityTypes.ts
// Shared types for the entity resolution engine.

export type EntityType = 'task' | 'habit' | 'goal' | 'project';

export type ResolutionMethod =
  | 'exact'
  | 'normalized'
  | 'fuzzy'
  | 'contextual'
  | 'structured'
  | 'semantic'
  | 'ambiguous';

/** A candidate real database entity the resolver can pick from. */
export interface ResolvableEntity {
  id: string;
  title: string;
  type: EntityType;
  status?: string | null;
  dueDate?: string | null;
  priority?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Extra attributes used for duplicate disambiguation. */
  disambiguators?: Record<string, string | null>;
}

/** One short candidate exposed for a clarification question or resolution. */
export interface EntityMatch {
  id: string;
  title: string;
}

export interface ResolutionResult {
  entityId: string | null;
  entityType: EntityType | null;
  confidence: number;
  method: ResolutionMethod;
  /** Populated when the resolver cannot safely pick a single entity. */
  matches?: EntityMatch[];
  reason?: string;
}

/** Suggested confidence thresholds (spec §16) — tuned vs. real conversations. */
export const EntityConfidence = {
  /** 0.95+ → auto resolve */
  AUTO: 0.95,
  /** 0.80–0.94 → strong confidence */
  STRONG: 0.8,
  /** 0.60–0.79 → route candidates to a semantic resolver */
  SEMANTIC: 0.6,
  /** < 0.60 → ask the user */
  ASK: 0.6,
} as const;

/** A resolved-entity summary attached to the coach prompt payload. */
export interface ResolvedEntityInfo {
  id: string;
  type: EntityType;
  title?: string;
  confidence: number;
  method: ResolutionMethod;
}