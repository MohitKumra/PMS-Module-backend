// backend/src/providers/razorpay/razorpay.client.ts
// HTTP client wrapper for Razorpay REST APIs.

import { env } from '../../config/env';

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

export async function razorpayRequest<T = any>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: any;
    headers?: Record<string, string>;
  } = {}
): Promise<T> {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;

  const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const url = `${RAZORPAY_API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const headers: Record<string, string> = {
    Authorization: authHeader,
    'Content-Type': 'application/json',
    ...options.headers,
  };

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data: any = await res.json();
    if (!res.ok) {
      const errorMsg = data?.error?.description || data?.error?.message || `Razorpay API error: ${res.status}`;
      const err = new Error(errorMsg);
      (err as any).status = res.status;
      (err as any).data = data;
      throw err;
    }

    return data as T;
  } catch (error: any) {
    console.error(`[RazorpayClient Error] ${options.method || 'GET'} ${endpoint}:`, error.message);
    throw error;
  }
}