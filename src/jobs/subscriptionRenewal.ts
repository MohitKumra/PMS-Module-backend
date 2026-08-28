// backend/src/jobs/subscriptionRenewal.ts
// Background job: simulates auto-renewals for locally-managed subscriptions in
// test/dummy mode (full-price renewals). Real Razorpay subscriptions are billed
// by Razorpay and handled via the webhook receiver, so they are intentionally
// not processed here.

import cron from 'node-cron';
import { renewDueLocalSubscriptions } from '../services/billing.service';

export function startSubscriptionRenewal(): void {
  console.info('🔁  Subscription renewal scheduler initialized (runs every minute).');
  (globalThis as any).__schedulerSubscriptionRunning = true;

  cron.schedule('*/1 * * * *', async () => {
    try {
      const count = await renewDueLocalSubscriptions();
      if (count > 0) {
        console.log(`[Billing] Processed ${count} due renewal(s).`);
      }
    } catch (err) {
      console.error('Error processing subscription renewals:', err);
    }
  });
}