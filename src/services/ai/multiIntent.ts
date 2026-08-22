// backend/src/services/ai/multiIntent.ts
// Splits a single user message into multiple operations when several distinct
// intents are present (spec §5). Every operation flows through the normal
// validation / safety layer downstream.

import { classifyIntent, CoachIntent } from './coachIntent';
import { extractReferencePhrase } from './messagePreprocessor';

export interface CoachOperation {
  intent: CoachIntent;
  /** The segment this operation came from. */
  segment: string;
  /** Extracted entity reference, when present. */
  entityReference?: string;
}

export interface MultiIntentResult {
  intentMode: 'single' | 'multi';
  /** Primary intent (first operation by default). */
  primaryIntent: CoachIntent;
  operations: CoachOperation[];
}

/**
 * Try to split a normalized message into parallel operations. We split on
 * explicit separators (" and ", " ; ") and keep an operation only when its
 * segment has a concrete, distinct intent. Short anaphoric follow-ups ("and
 * mark it complete") are folded into the preceding operation's segment.
 */
export function splitMultiIntent(normalizedMessage: string): MultiIntentResult {
  const segments = normalizedMessage
    .split(/\s+(?:and|&\s*)\s+|;/)
    .map((s) => s.trim())
    .filter(Boolean);

  const ops: CoachOperation[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    // Re-attach anaphoric tails ("mark it complete") to the segment before it.
    const intent = classifyIntent(segment);
    if (intent === CoachIntent.COACHING && ops.length > 0) {
      ops[ops.length - 1].segment = `${ops[ops.length - 1].segment} ${segment}`;
      continue;
    }
    if (intent === CoachIntent.CHITCHAT || intent === CoachIntent.COACHING) {
      continue; // not an operation
    }
    const ref = extractReferencePhrase(segment);
    ops.push({
      intent,
      segment,
      ...(ref ? { entityReference: ref } : {}),
    });
  }

  if (ops.length === 0) {
    const fallbackIntent = classifyIntent(normalizedMessage);
    const ref = extractReferencePhrase(normalizedMessage);
    return {
      intentMode: 'single',
      primaryIntent: fallbackIntent,
      operations: [
        {
          intent: fallbackIntent,
          segment: normalizedMessage,
          ...(ref ? { entityReference: ref } : {}),
        },
      ],
    };
  }

  const unique = ops.filter((op, idx) => {
    // Collapse duplicate intents (e.g. two COMPLETEs) into the first.
    return ops.findIndex((o) => o.intent === op.intent) === idx;
  });

  return {
    intentMode: unique.length > 1 ? 'multi' : 'single',
    primaryIntent: unique[0].intent,
    operations: unique,
  };
}