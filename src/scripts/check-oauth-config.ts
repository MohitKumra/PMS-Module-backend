/**
 * Check OAuth configuration and scopes
 * Run with: npx tsx src/scripts/check-oauth-config.ts
 */

import { env } from '../config/env';
import { prisma } from '../lib/prismaClient';

async function checkOAuthConfig() {
  console.log('\n=== OAuth Configuration Checker ===\n');

  // 1. Check environment variables
  console.log('1. Environment Variables:\n');
  
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.error('❌ Google OAuth is not configured in .env file');
    console.log('\nAdd these to your .env:');
    console.log('GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com');
    console.log('GOOGLE_CLIENT_SECRET=GOCSPX-your-secret\n');
    return;
  }

  console.log(`✓ GOOGLE_CLIENT_ID: ${env.GOOGLE_CLIENT_ID}`);
  console.log(`✓ GOOGLE_CLIENT_SECRET: ${env.GOOGLE_CLIENT_SECRET.substring(0, 15)}...`);
  console.log(`✓ BACKEND_URL: ${env.BACKEND_URL}`);
  console.log(`✓ FRONTEND_URL: ${env.FRONTEND_URL}`);

  // 2. Check OAuth redirect URI
  console.log('\n2. OAuth Redirect URI:\n');
  const redirectUri = `${env.BACKEND_URL}/api/auth/google/callback`;
  console.log(`OAuth callback: ${redirectUri}`);
  console.log('\n⚠️  IMPORTANT: This URL must be added to "Authorized redirect URIs" in Google Cloud Console');
  console.log('   Go to: https://console.cloud.google.com/apis/credentials');
  console.log(`   Add: ${redirectUri}\n`);

  // 3. Check scopes in code
  console.log('3. OAuth Scopes Configuration:\n');
  console.log('For SIGN IN (signin purpose):');
  console.log('  - openid');
  console.log('  - email');
  console.log('  - profile');
  
  console.log('\nFor CALENDAR SYNC (calendar-connect purpose):');
  console.log('  - openid');
  console.log('  - email');
  console.log('  - profile');
  console.log('  - https://www.googleapis.com/auth/calendar.events ← REQUIRED FOR CALENDAR');

  // 4. Check user connections
  console.log('\n4. User Connections:\n');
  
  const connections = await prisma.googleCalendarConnection.findMany({
    include: {
      user: { select: { email: true } },
    },
    orderBy: { connectedAt: 'desc' },
    take: 5,
  });

  if (connections.length === 0) {
    console.log('No users have connected Google Calendar yet.');
    console.log('\nTo connect:');
    console.log('1. Go to Settings → Integrations in your app');
    console.log('2. Click "Connect Google Calendar"');
    console.log('3. Authorize all permissions\n');
    return;
  }

  console.log(`Found ${connections.length} connection(s):\n`);

  connections.forEach((conn, i) => {
    console.log(`${i + 1}. ${conn.user.email}`);
    console.log(`   Connected: ${conn.connectedAt.toISOString()}`);
    console.log(`   Scopes granted: ${conn.scope}`);
    
    // Check if calendar.events scope is present
    const hasCalendarScope = conn.scope.includes('https://www.googleapis.com/auth/calendar.events') ||
                             conn.scope.includes('https://www.googleapis.com/auth/calendar');
    
    if (!hasCalendarScope) {
      console.error(`   ❌ MISSING CALENDAR SCOPE!`);
      console.log(`   \nThis is why tasks aren't syncing!`);
      console.log(`   \nFix:`);
      console.log(`   1. User needs to disconnect and reconnect Google Calendar`);
      console.log(`   2. Make sure they authorize all permissions`);
      console.log(`   3. The consent screen should show: "See, edit, share, and permanently delete all calendars"`);
    } else {
      console.log(`   ✓ Has calendar scope`);
    }
    
    console.log(`   Active: ${conn.isActive ? '✓' : '✗'}`);
    console.log(`   Sync enabled: ${conn.syncTasks ? '✓' : '✗'}`);
    console.log('');
  });

  // 5. Test OAuth URL generation
  console.log('5. Testing OAuth URL Generation:\n');
  
  console.log('For calendar connection, the OAuth URL should include:');
  console.log('  - scope=openid%20email%20profile%20https://www.googleapis.com/auth/calendar.events');
  console.log('  - access_type=offline');
  console.log('  - prompt=consent');
  
  console.log('\nTo test, visit this in your browser (as a logged-in user):');
  console.log(`${env.BACKEND_URL}/api/settings/google-calendar/start`);
  console.log('\nThis should redirect to Google OAuth with the correct scopes.\n');

  // 6. Google Cloud Console checklist
  console.log('6. Google Cloud Console Checklist:\n');
  
  console.log('□ Go to: https://console.cloud.google.com');
  console.log('□ Select your project');
  console.log('□ Go to: APIs & Services → Credentials');
  console.log(`□ Your OAuth Client ID: ${env.GOOGLE_CLIENT_ID}`);
  console.log('□ Check "Authorized redirect URIs" includes:');
  console.log(`    ${redirectUri}`);
  console.log('\n□ Go to: APIs & Services → OAuth consent screen');
  console.log('□ Check "Scopes for Google APIs" includes:');
  console.log('    .../auth/userinfo.email');
  console.log('    .../auth/userinfo.profile');
  console.log('    openid');
  console.log('    .../auth/calendar.events ← MOST IMPORTANT');
  console.log('\n□ Go to: APIs & Services → Library');
  console.log('□ Search "Google Calendar API"');
  console.log('□ Make sure it\'s ENABLED\n');

  // 7. Common issues
  console.log('7. Common Issues:\n');
  
  console.log('❌ Issue: "Insufficient Permission" error');
  console.log('   Cause: Missing calendar.events scope');
  console.log('   Fix: Add scope to OAuth consent screen, then reconnect\n');
  
  console.log('❌ Issue: Tasks sync for some users but not others');
  console.log('   Cause: Users connected before scope was added');
  console.log('   Fix: All users must disconnect and reconnect\n');
  
  console.log('❌ Issue: OAuth consent shows "This app hasn\'t been verified"');
  console.log('   Cause: App is in testing mode');
  console.log('   Fix: Either publish the app OR add test users\n');

  console.log('=== Check Complete ===\n');
}

checkOAuthConfig()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
