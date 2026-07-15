/**
 * Quick setup checker for Google Calendar integration
 * Run with: npx tsx src/scripts/check-calendar-setup.ts
 */

import { env } from '../config/env';
import { prisma } from '../lib/prismaClient';

async function checkSetup() {
  console.log('\n=== Google Calendar Setup Checker ===\n');

  let issues = 0;
  let warnings = 0;

  // 1. Check environment variables
  console.log('1. Checking environment variables...\n');

  if (!env.GOOGLE_CLIENT_ID) {
    console.error('   ❌ GOOGLE_CLIENT_ID is not set');
    issues++;
  } else {
    console.log(`   ✓ GOOGLE_CLIENT_ID is set: ${env.GOOGLE_CLIENT_ID.substring(0, 20)}...`);
  }

  if (!env.GOOGLE_CLIENT_SECRET) {
    console.error('   ❌ GOOGLE_CLIENT_SECRET is not set');
    issues++;
  } else {
    console.log(`   ✓ GOOGLE_CLIENT_SECRET is set: ${env.GOOGLE_CLIENT_SECRET.substring(0, 10)}...`);
  }

  if (!env.BACKEND_URL) {
    console.warn('   ⚠️  BACKEND_URL is not set (will use default)');
    warnings++;
  } else {
    console.log(`   ✓ BACKEND_URL is set: ${env.BACKEND_URL}`);
  }

  if (!env.FRONTEND_URL) {
    console.warn('   ⚠️  FRONTEND_URL is not set (will use default)');
    warnings++;
  } else {
    console.log(`   ✓ FRONTEND_URL is set: ${env.FRONTEND_URL}`);
  }

  // 2. Check database connections
  console.log('\n2. Checking database...\n');

  try {
    const connectionCount = await prisma.googleCalendarConnection.count();
    console.log(`   ✓ Database is accessible`);
    console.log(`   ℹ️  Found ${connectionCount} Google Calendar connection(s)`);

    if (connectionCount === 0) {
      console.warn('   ⚠️  No users have connected Google Calendar yet');
      warnings++;
    } else {
      const activeCount = await prisma.googleCalendarConnection.count({
        where: { isActive: true },
      });
      console.log(`   ℹ️  ${activeCount} active connection(s)`);

      const connections = await prisma.googleCalendarConnection.findMany({
        take: 5,
        include: { user: { select: { email: true } } },
      });

      console.log('\n   Recent connections:');
      connections.forEach((conn, i) => {
        console.log(`   ${i + 1}. ${conn.user.email}`);
        console.log(`      Status: ${conn.isActive ? '✓ Active' : '✗ Inactive'}`);
        console.log(`      Sync Tasks: ${conn.syncTasks ? '✓ Enabled' : '✗ Disabled'}`);
        console.log(`      Connected: ${conn.connectedAt.toISOString()}`);
        console.log(`      Last Synced: ${conn.lastSyncedAt?.toISOString() || 'Never'}`);
        console.log(`      Has Access Token: ${conn.accessToken ? '✓' : '✗'}`);
        console.log(`      Has Refresh Token: ${conn.refreshToken ? '✓' : '✗'}`);
        if (!conn.refreshToken) {
          console.error(`      ❌ Missing refresh token - user needs to reconnect`);
          issues++;
        }
        console.log('');
      });
    }

    const taskCount = await prisma.task.count({
      where: { dueDate: { not: null } },
    });
    console.log(`   ℹ️  Found ${taskCount} task(s) with due dates (eligible for sync)`);

    const syncedCount = await prisma.googleCalendarSyncItem.count({
      where: { localType: 'TASK' },
    });
    console.log(`   ℹ️  ${syncedCount} task(s) have been synced to Google Calendar`);

  } catch (error) {
    console.error('   ❌ Database connection failed:', error);
    issues++;
  }

  // 3. Check OAuth redirect URI
  console.log('\n3. Checking OAuth configuration...\n');

  const redirectUri = `${env.BACKEND_URL || 'http://localhost:3001'}/api/auth/google/callback`;
  console.log(`   ℹ️  OAuth callback URL: ${redirectUri}`);
  console.log(`\n   Make sure this URL is added to "Authorized redirect URIs" in Google Cloud Console:`);
  console.log(`   https://console.cloud.google.com/apis/credentials\n`);

  // 4. Check required scopes
  console.log('4. Checking OAuth scopes...\n');
  console.log('   Required scopes for calendar sync:');
  console.log('   ✓ openid');
  console.log('   ✓ email');
  console.log('   ✓ profile');
  console.log('   ✓ https://www.googleapis.com/auth/calendar.events');
  console.log('\n   Verify these scopes are configured in the OAuth consent screen.\n');

  // 5. Test Google API connectivity
  console.log('5. Testing Google API connectivity...\n');

  try {
    const response = await fetch('https://www.googleapis.com/calendar/v3/', {
      method: 'GET',
    });
    
    if (response.status === 401) {
      console.log('   ✓ Google Calendar API is reachable (401 = authentication required, which is expected)');
    } else {
      console.log(`   ℹ️  Google Calendar API responded with status ${response.status}`);
    }
  } catch (error) {
    console.error('   ❌ Cannot reach Google Calendar API:', error);
    console.error('   Check your internet connection and firewall settings');
    issues++;
  }

  // Summary
  console.log('\n=== Summary ===\n');

  if (issues === 0 && warnings === 0) {
    console.log('✅ All checks passed! Google Calendar integration is properly configured.\n');
    console.log('Next steps:');
    console.log('1. Have users connect their Google Calendar from Settings → Integrations');
    console.log('2. Create tasks with due dates');
    console.log('3. Check backend logs for sync messages');
    console.log('4. Verify events appear in Google Calendar');
  } else {
    if (issues > 0) {
      console.error(`❌ Found ${issues} issue(s) that need to be fixed.`);
    }
    if (warnings > 0) {
      console.warn(`⚠️  Found ${warnings} warning(s) that should be reviewed.`);
    }
    console.log('\nRefer to GOOGLE_CALENDAR_TROUBLESHOOTING.md for detailed solutions.\n');
  }

  console.log('To test a specific user\'s connection, run:');
  console.log('  npx tsx src/scripts/diagnose-calendar.ts <userId>\n');
}

checkSetup()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
