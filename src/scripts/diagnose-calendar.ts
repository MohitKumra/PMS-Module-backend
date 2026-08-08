/**
 * Diagnostic script to test Google Calendar integration
 * Run with: npx tsx src/scripts/diagnose-calendar.ts <userId>
 */

import { prisma } from '../lib/prismaClient';
import crypto from 'crypto';
import { env } from '../config/env';

function encryptionKey(): Buffer {
  return crypto.createHash('sha256').update(env.JWT_REFRESH_SECRET).digest();
}

function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const [version, ivB64, encryptedB64, tagB64] = value.split(':');
  if (version !== 'v1' || !ivB64 || !encryptedB64 || !tagB64) return value;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

async function diagnoseCalendar(userId: string) {
  console.log('\n=== Google Calendar Integration Diagnostic ===\n');

  // 1. Check user exists
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    console.error('❌ User not found');
    return;
  }
  console.log(`✓ User found: ${user.email} (${user.name || 'No name'})`);
  console.log(`  Timezone: ${user.timezone || 'UTC'}`);

  // 2. Check Google Calendar connection
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
  if (!connection) {
    console.error('❌ No Google Calendar connection found');
    console.log('\nAction needed: Connect Google Calendar from Settings → Integrations');
    return;
  }

  console.log(`\n✓ Google Calendar connected`);
  console.log(`  Google Email: ${connection.googleEmail}`);
  console.log(`  Active: ${connection.isActive ? '✓' : '✗'}`);
  console.log(`  Sync Tasks: ${connection.syncTasks ? '✓' : '✗'}`);
  console.log(`  Calendar ID: ${connection.calendarId || 'primary'}`);
  console.log(`  Connected At: ${connection.connectedAt.toISOString()}`);
  console.log(`  Last Synced: ${connection.lastSyncedAt?.toISOString() || 'Never'}`);
  console.log(`  Token Expires: ${connection.expiresAt?.toISOString() || 'Unknown'}`);

  if (!connection.isActive) {
    console.error('\n❌ Connection is inactive');
    console.log('Action needed: Reconnect Google Calendar from Settings');
    return;
  }

  if (!connection.syncTasks) {
    console.warn('\n⚠️  Task sync is disabled');
    console.log('Action needed: Enable task sync in Settings');
    return;
  }

  // 3. Check tokens
  const hasAccessToken = Boolean(connection.accessToken);
  const hasRefreshToken = Boolean(connection.refreshToken);
  console.log(`\n  Has Access Token: ${hasAccessToken ? '✓' : '✗'}`);
  console.log(`  Has Refresh Token: ${hasRefreshToken ? '✓' : '✗'}`);

  if (!hasRefreshToken) {
    console.error('\n❌ Missing refresh token');
    console.log('Action needed: Reconnect Google Calendar (tokens need to be re-authorized)');
    return;
  }

  // 4. Check token validity
  const now = Date.now();
  const expiresAt = connection.expiresAt?.getTime();
  if (!expiresAt || expiresAt <= now) {
    console.warn('\n⚠️  Access token is expired or missing');
    console.log('  This is normal - token will be refreshed automatically on next sync');
  } else {
    const minutesLeft = Math.round((expiresAt - now) / 60000);
    console.log(`\n✓ Access token valid for ${minutesLeft} more minutes`);
  }

  // 5. Test token decryption
  try {
    const decryptedAccess = decryptSecret(connection.accessToken);
    const decryptedRefresh = decryptSecret(connection.refreshToken);
    console.log(`\n✓ Tokens can be decrypted successfully`);
    console.log(`  Access Token Length: ${decryptedAccess?.length || 0} chars`);
    console.log(`  Refresh Token Length: ${decryptedRefresh?.length || 0} chars`);
  } catch (error) {
    console.error('\n❌ Failed to decrypt tokens:', error);
    console.log('Action needed: Reconnect Google Calendar (encryption key may have changed)');
    return;
  }

  // 6. Check tasks with due dates
  const tasks = await prisma.task.findMany({
    where: { userId, dueDate: { not: null } },
    orderBy: { dueDate: 'asc' },
    take: 5,
  });

  console.log(`\n✓ Found ${tasks.length} task(s) with due dates (showing first 5):`);
  if (tasks.length === 0) {
    console.warn('\n⚠️  No tasks with due dates found');
    console.log('Action needed: Create tasks with due dates to sync to calendar');
  } else {
    tasks.forEach((task, i) => {
      console.log(`\n  ${i + 1}. "${task.title}"`);
      console.log(`     Status: ${task.status}, Priority: ${task.priority}`);
      console.log(`     Due Date: ${task.dueDate?.toISOString()}`);
      console.log(`     Created: ${task.createdAt.toISOString()}`);
    });
  }

  // 7. Check sync items
  const syncItems = await prisma.googleCalendarSyncItem.findMany({
    where: { userId, localType: 'TASK' },
    orderBy: { syncedAt: 'desc' },
    take: 5,
  });

  console.log(`\n✓ Found ${syncItems.length} synced item(s) (showing first 5):`);
  if (syncItems.length === 0) {
    console.log('  No items have been synced yet');
  } else {
    syncItems.forEach((item, i) => {
      console.log(`\n  ${i + 1}. Task ID: ${item.localId.substring(0, 8)}...`);
      console.log(`     Google Event ID: ${item.googleEventId}`);
      console.log(`     Calendar ID: ${item.calendarId || 'primary'}`);
      console.log(`     Synced At: ${item.syncedAt.toISOString()}`);
    });
  }

  // 8. Test Google Calendar API with a simple call
  console.log(`\n=== Testing Google Calendar API ===\n`);

  const refreshToken = decryptSecret(connection.refreshToken);
  if (!refreshToken) {
    console.error('❌ Cannot test API - refresh token missing');
    return;
  }

  try {
    // Try to refresh token
    console.log('Testing token refresh...');
    const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: env.GOOGLE_CLIENT_ID ?? '',
        client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
        grant_type: 'refresh_token',
      }),
    });

    if (!refreshResponse.ok) {
      const errorText = await refreshResponse.text();
      console.error('❌ Token refresh failed:', errorText);
      console.log('\nPossible issues:');
      console.log('  - Refresh token has been revoked');
      console.log('  - OAuth credentials are incorrect');
      console.log('  - User revoked access from their Google Account');
      console.log('\nAction needed: Reconnect Google Calendar from Settings');
      return;
    }

    const tokenData: any = await refreshResponse.json();
    console.log(`✓ Token refresh successful`);
    console.log(`  New access token received (expires in ${tokenData.expires_in}s)`);

    // Try to list calendars
    console.log('\nTesting calendar list API...');
    const calendarListResponse = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!calendarListResponse.ok) {
      const errorText = await calendarListResponse.text();
      console.error('❌ Calendar list failed:', errorText);
      return;
    }

    const calendarList: any = await calendarListResponse.json();
    console.log(`✓ Calendar list successful`);
    console.log(`  Found ${calendarList.items?.length || 0} calendar(s):`);
    calendarList.items?.slice(0, 3).forEach((cal: any) => {
      console.log(`    - ${cal.summary} (${cal.id})${cal.primary ? ' [PRIMARY]' : ''}`);
    });

    // Try to create a test event
    const targetCalendarId = connection.calendarId || 'primary';
    console.log(`\nTesting event creation on calendar: ${targetCalendarId}...`);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const testEventPayload = {
      summary: '[TEST] Calendar Sync Diagnostic',
      description: 'This is a test event created by the diagnostic script. You can delete it.',
      start: { date: tomorrow.toISOString().split('T')[0] },
      end: { date: dayAfter.toISOString().split('T')[0] },
      reminders: { useDefault: true },
    };

    console.log(`  Event payload:`, JSON.stringify(testEventPayload, null, 2));

    const createResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testEventPayload),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      let errorJson;
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        errorJson = errorText;
      }
      console.error('❌ Event creation failed:', JSON.stringify(errorJson, null, 2));
      console.log('\nPossible issues:');
      console.log('  - Calendar ID is invalid');
      console.log('  - Missing calendar.events scope');
      console.log('  - Calendar does not allow write access');
      console.log(`  - Check calendar permissions for: ${targetCalendarId}`);
      return;
    }

    const createdEvent: any = await createResponse.json();
    console.log(`\n✅ SUCCESS! Test event created:`);
    console.log(`  Event ID: ${createdEvent.id}`);
    console.log(`  HTML Link: ${createdEvent.htmlLink}`);
    console.log(`  Status: ${createdEvent.status}`);
    console.log(`\n  Check your Google Calendar to see the test event!`);
    console.log(`  You can delete it manually or it will be removed on next full sync.`);

    // Clean up test event
    console.log(`\nCleaning up test event...`);
    const deleteResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events/${createdEvent.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      }
    );

    if (deleteResponse.ok) {
      console.log(`✓ Test event cleaned up successfully`);
    } else {
      console.log(`⚠️  Could not delete test event (you may need to delete it manually)`);
    }
  } catch (error) {
    console.error('\n❌ API test failed with error:', error);
    return;
  }

  console.log(`\n=== Diagnostic Complete ===\n`);
  console.log(`Summary:`);
  console.log(`  ✓ Connection is properly configured`);
  console.log(`  ✓ Tokens are valid and working`);
  console.log(`  ✓ Google Calendar API is accessible`);
  console.log(`  ✓ Events can be created successfully`);
  console.log(`\nIf tasks are still not syncing:`);
  console.log(`  1. Make sure tasks have due dates set`);
  console.log(`  2. Check backend logs when creating/updating tasks`);
  console.log(`  3. Trigger manual sync: POST /api/settings/google-calendar/sync`);
  console.log(`  4. Check for any error messages in the console`);
}

const userId = process.argv[2];
if (!userId) {
  console.error('Usage: npx tsx src/scripts/diagnose-calendar.ts <userId>');
  process.exit(1);
}

diagnoseCalendar(userId)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
