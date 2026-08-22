import { describe, it, expect } from 'vitest';
import { preprocessMessage, normalizeMessage, extractReferencePhrase } from '../../src/services/ai/messagePreprocessor';

describe('normalizeMessage', () => {
  it('lowercases, collapses whitespace, and normalizes curly quotes', () => {
    expect(normalizeMessage('  FINISH   THE  LANDING  ')).toBe('finish the landing');
    expect(normalizeMessage('\u201CMark it\u201D')).toBe('"mark it"');
  });

  it('expands colloquial date abbreviations', () => {
    expect(normalizeMessage('finish the presenation tmrw')).toBe('finish the presenation tomorrow');
    expect(normalizeMessage('call tmr')).toBe('call tomorrow');
  });
});

describe('preprocessMessage', () => {
  it('extracts a reference and strips stopwords', () => {
    const p = preprocessMessage('finish the landing page', 'UTC');
    expect(p.references[0]).toBe('landing page');
  });

  it('resolves a typo + date reference deterministically', () => {
    const p = preprocessMessage('finish the presenation tmrw', 'UTC');
    expect(p.normalizedMessage).toContain('presenation');
    expect(p.normalizedMessage).toContain('tomorrow');
    expect(p.extractedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.references[0]).toBe('presenation');
  });

  it('extracts a simple time phrase', () => {
    const p = preprocessMessage('meet at 3pm', 'UTC');
    expect(p.extractedTime).toBe('15:00');
  });
});

describe('extractReferencePhrase', () => {
  it('removes leading action verbs', () => {
    expect(extractReferencePhrase('mark the presentation complete')).toBe('presentation complete');
  });

  it('returns null for an empty phrase', () => {
    expect(extractReferencePhrase('')).toBeNull();
    expect(extractReferencePhrase('the')).toBeNull();
  });
});