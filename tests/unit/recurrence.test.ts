import { describe, it, expect } from 'vitest';
import { buildRecurrenceFromConfig, recurrenceConfigToRule, getNextOccurrence } from '../../src/services/task.service';
import type { TaskRecurrenceConfig } from '../../src/types';

describe('buildRecurrenceFromConfig', () => {
  const base: TaskRecurrenceConfig = {
    enabled: true,
    frequency: 'day',
    interval: 1,
  };

  it('returns null rule when disabled', () => {
    const result = buildRecurrenceFromConfig({ ...base, enabled: false }, new Date('2026-01-01'));
    expect(result.recurrenceRule).toBeNull();
    expect(result.recurrenceEndDate).toBeNull();
    expect(result.dueDate).toEqual(new Date('2026-01-01'));
  });

  it('builds a daily rule', () => {
    const result = buildRecurrenceFromConfig({ ...base, frequency: 'day', interval: 1 }, new Date('2026-01-01'));
    expect(result.recurrenceRule).toBe('FREQ=DAILY;INTERVAL=1');
  });

  it('builds a weekly rule with weekdays', () => {
    const result = buildRecurrenceFromConfig(
      { ...base, frequency: 'week', interval: 2, weekdays: ['MO', 'WE', 'FR'] },
      new Date('2026-01-01')
    );
    expect(result.recurrenceRule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR');
  });

  it('builds a monthly rule with day of month', () => {
    const result = buildRecurrenceFromConfig({ ...base, frequency: 'month', dayOfMonth: 15 }, new Date('2026-01-01'));
    expect(result.recurrenceRule).toContain('FREQ=MONTHLY');
    expect(result.recurrenceRule).toContain('BYMONTHDAY=15');
  });

  it('handles occurrence count', () => {
    const result = buildRecurrenceFromConfig(
      { ...base, endsType: 'occurrences', occurrenceCount: 5 },
      new Date('2026-01-01')
    );
    expect(result.recurrenceRule).toContain('COUNT=5');
    expect(result.recurrenceEndDate).toBeNull();
  });
});

describe('recurrenceConfigToRule', () => {
  it('returns empty object when config is undefined', () => {
    expect(recurrenceConfigToRule(undefined)).toEqual({});
  });

  it('returns empty object when disabled', () => {
    expect(recurrenceConfigToRule({ enabled: false, frequency: 'day', interval: 1 })).toEqual({});
  });

  it('uses startsAt when provided', () => {
    const result = recurrenceConfigToRule(
      { enabled: true, frequency: 'day', interval: 1, startsAt: '2026-02-01' },
      new Date('2026-01-01')
    );
    expect(result.dueDate).toEqual(new Date('2026-02-01'));
  });
});

describe('getNextOccurrence', () => {
  it('returns null when no recurrence rule', () => {
    expect(getNextOccurrence(new Date('2026-01-01'), null, null, [])).toBeNull();
  });

  it('returns next daily occurrence', () => {
    const next = getNextOccurrence(new Date('2026-01-01'), 'FREQ=DAILY;INTERVAL=1', null, []);
    expect(next?.toISOString().split('T')[0]).toBe('2026-01-02');
  });

  it('skips dates in skipDates', () => {
    const next = getNextOccurrence(new Date('2026-01-01'), 'FREQ=DAILY;INTERVAL=1', null, ['2026-01-02']);
    expect(next?.toISOString().split('T')[0]).toBe('2026-01-03');
  });

  it('respects recurrenceEndDate', () => {
    const next = getNextOccurrence(new Date('2026-01-01'), 'FREQ=DAILY;INTERVAL=1', new Date('2026-01-01'), []);
    expect(next).toBeNull();
  });
});
