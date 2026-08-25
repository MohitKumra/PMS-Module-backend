import { describe, it, expect } from 'vitest';
import { coerceSkipDays, normalizeSubTasks } from '../../src/services/ai/coachActions';

describe('coerceSkipDays', () => {
  it('maps day-name strings to numeric indices', () => {
    expect(coerceSkipDays(['Saturday', 'Sunday'])).toEqual([5, 6]);
    expect(coerceSkipDays('Monday')).toEqual([0]);
    expect(coerceSkipDays(['monday', 'wednesday', 'friday'])).toEqual([0, 2, 4]);
  });

  it('parses a comma-delimited day-name string', () => {
    expect(coerceSkipDays('Saturday, Sunday')).toEqual([5, 6]);
    expect(coerceSkipDays('saturday,sunday')).toEqual([5, 6]);
    expect(coerceSkipDays('Monday, Friday')).toEqual([0, 4]);
  });

  it('parses a comma-delimited numeric string', () => {
    expect(coerceSkipDays('5,6')).toEqual([5, 6]);
    expect(coerceSkipDays('0, 4')).toEqual([0, 4]);
  });

  it('accepts numeric arrays as-is', () => {
    expect(coerceSkipDays([5, 6])).toEqual([5, 6]);
    expect(coerceSkipDays([0, 1, 2, 3, 4, 5, 6])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('accepts numeric-string arrays', () => {
    expect(coerceSkipDays(['5', '6'])).toEqual([5, 6]);
    expect(coerceSkipDays(['0'])).toEqual([0]);
  });

  it('supports a single numeric value', () => {
    expect(coerceSkipDays(5)).toEqual([5]);
  });

  it('de-duplicates and sorts, ignoring out-of-range values', () => {
    expect(coerceSkipDays(['Saturday', 'saturday', 5, '5', 6])).toEqual([5, 6]);
    expect(coerceSkipDays([9, -1, 'not-a-day'])).toEqual([]);
  });

  it('returns [] for null / undefined / empty', () => {
    expect(coerceSkipDays(null)).toEqual([]);
    expect(coerceSkipDays(undefined)).toEqual([]);
    expect(coerceSkipDays('')).toEqual([]);
    expect(coerceSkipDays([])).toEqual([]);
  });
});

describe('normalizeSubTasks', () => {
  it('normalizes a string array', () => {
    expect(normalizeSubTasks(['gather data', 'create deck', 'approve'])).toEqual([
      { title: 'gather data', order: 0 },
      { title: 'create deck', order: 1 },
      { title: 'approve', order: 2 },
    ]);
  });

  it('normalizes an object array preserving order', () => {
    expect(normalizeSubTasks([{ title: 'a' }, { title: 'b' }])).toEqual([
      { title: 'a', order: 0 },
      { title: 'b', order: 1 },
    ]);
  });

  it('trims titles and drops empties', () => {
    expect(normalizeSubTasks(['  a  ', '', '   ', 'b'])).toEqual([
      { title: 'a', order: 0 },
      { title: 'b', order: 1 },
    ]);
  });

  it('handles null / undefined / single string', () => {
    expect(normalizeSubTasks(null)).toEqual([]);
    expect(normalizeSubTasks(undefined)).toEqual([]);
    expect(normalizeSubTasks('only one')).toEqual([{ title: 'only one', order: 0 }]);
  });
});
