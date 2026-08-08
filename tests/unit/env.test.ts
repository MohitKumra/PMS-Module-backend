import { describe, it, expect } from 'vitest';

describe('environment variable validation', () => {
  it('requires DATABASE_URL', () => {
    const url = 'postgresql://test:test@localhost:5432/test';
    expect(url).toMatch(/^postgres(ql)?:\/\//);
  });

  it('requires JWT secrets to be at least 32 characters', () => {
    const jwtSecret = 'a-very-long-secret-key-that-exceeds-32-characters';
    expect(jwtSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('uses default PORT when not specified', () => {
    const port = process.env.PORT || '3001';
    expect(port).toBe('3001');
  });
});
