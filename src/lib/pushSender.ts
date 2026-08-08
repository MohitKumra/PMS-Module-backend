// backend/src/lib/pushSender.ts
// Handles sending Web Push notifications to a client subscription.
// Integrates with the web-push library using VAPID details defined in config/env.ts.

import webpush from 'web-push';
import { env } from '../config/env';

let vapidConfigured = false;

function configureVapid(): boolean {
  if (vapidConfigured) return true;

  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    try {
      webpush.setVapidDetails(env.VAPID_EMAIL, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
      vapidConfigured = true;
      console.info('🔌  Web Push VAPID keys configured successfully.');
      return true;
    } catch (err) {
      console.error('❌  Web Push: failed to set VAPID details', err);
      return false;
    }
  } else {
    console.warn('⚠️  Web Push VAPID keys not configured. Push notifications will be stubbed.');
    return false;
  }
}

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscription {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  data?: Record<string, unknown>;
}

/**
 * Sends a web push notification to a user's subscription.
 * Gracefully logs if push VAPID keys aren't configured or if the push fails.
 */
export async function sendPush(subscription: PushSubscription, payload: PushPayload): Promise<boolean> {
  const isReady = configureVapid();
  if (!isReady) {
    console.info(`🔔  [Push Stub] To: ${subscription.endpoint.slice(0, 30)}... | Payload: ${JSON.stringify(payload)}`);
    return false;
  }

  try {
    const formattedSub = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    };

    await webpush.sendNotification(formattedSub, JSON.stringify(payload));
    return true;
  } catch (error) {
    console.error('❌  Web Push failed:', error);
    // If the subscription is no longer active (410 Gone / 404 Not Found),
    // we should ideally delete it. We return false so the caller knows it failed.
    return false;
  }
}
