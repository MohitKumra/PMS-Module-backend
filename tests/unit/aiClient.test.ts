import { describe, it, expect } from 'vitest';
import { extractChatContent, extractResponseText, stripThinkBlock } from '../../src/services/ai/aiClient';

describe('extractChatContent', () => {
  it('returns the assistant content string', () => {
    expect(extractChatContent({ content: 'Hello' })).toBe('Hello');
  });

  it('returns null when the message is null', () => {
    expect(extractChatContent(null)).toBeNull();
  });

  it('returns null when content is empty and there is no reasoning', () => {
    expect(extractChatContent({ content: '  ' })).toBeNull();
    expect(extractChatContent({ content: null })).toBeNull();
  });

  it('falls back to reasoning_content when content is empty', () => {
    const msg = { content: null as string | null, reasoning_content: 'reasoned answer' };
    expect(extractChatContent(msg)).toBe('reasoned answer');
  });

  it('flattens a content array of text parts', () => {
    const msg = { content: [{ text: 'part one ' }, { text: 'part two' }] as Array<{ text: string }> };
    expect(extractChatContent(msg)).toBe('part one part two');
  });
});

describe('extractResponseText', () => {
  it('prefers output_text when present', () => {
    expect(extractResponseText({ output_text: '  answer  ' })).toBe('answer');
  });

  it('returns null when no text is present', () => {
    expect(extractResponseText({})).toBeNull();
  });

  it('flattens output_text items in output', () => {
    const response = {
      output: [
        { type: 'output_text', text: 'A' },
        { type: 'output_text', text: 'B' },
      ],
    };
    expect(extractResponseText(response)).toBe('AB');
  });

  it('flattens nested content arrays', () => {
    const response = {
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'nested' }] }],
    };
    expect(extractResponseText(response)).toBe('nested');
  });
});

describe('stripThinkBlock', () => {
  it('strips a trailing think block', () => {
    expect(stripThinkBlock('answer <think>reason</think>')).toBe('answer');
  });

  it('returns trimmed text when there is no think block', () => {
    expect(stripThinkBlock('  plain answer  ')).toBe('plain answer');
  });
});
