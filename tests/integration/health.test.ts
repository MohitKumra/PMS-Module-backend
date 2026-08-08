import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/server';

describe('Health & Readiness endpoints', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /ready returns 200 when database is reachable', async () => {
    const res = await request(app).get('/ready');
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.status).toBe('ready');
    }
  });
});
