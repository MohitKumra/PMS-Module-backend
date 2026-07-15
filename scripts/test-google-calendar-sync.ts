/**
 * Test script for Google Calendar sync
 * 
 * Usage: npx tsx scripts/test-google-calendar-sync.ts <userId>
 */

import { prisma } from '../src/lib/prismaClient';
import { syncGoogleCalendarTasks } from '../src/services/google.service';

async function main() {
  const userId = process.argv[2];
  
  if (!userId) {
    console.error('Usage: npx tsx scripts/test-google-calendar-sync.ts <userId>');
    process.exit(1);
  }

  console.log('=== Google Calendar Sync Test ===\n');

  // Check user exists
  const user = await prisma.user.findUnique({ 
    where: { id: userId },
    include: { notificationPreferences: true }
  });
  
  if (!user) {
    console.error(`❌ User not found: ${userId}`);
    process.exit(1);
  }
  
  console.log(`✅ User found: ${user.email}\n`);

  // Check Google Calendar connection
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { userId }
  });

  if (!connection) {
    console.error('❌ Google Calendar not connected');
    console.log('   → Go to Settings and connect Google Calendar');
    process.exit(1);
  }

  console.log('📅 Google Calendar Connection:');
  console.log(`   Email: ${connection.googleEmail}`);
  console.log(`   Active: ${connection.isActive}`);
  console.log(`   Sync Tasks: ${connection.syncTasks}`);
  console.log(`   Calendar ID: ${connection.calendarId || 'primary'}`);
  console.log(`   Connected At: ${connection.connectedAt}`);
  console.log(`   Last Synced: ${connection.lastSyncedAt || 'Never'}`);
  console.log(`   Token Expires: ${connection.expiresAt}`);
  console.log();

  if (!connection.isActive) {
    console.error('❌ Connection is not active');
    console.log('   → Reconnect Google Calendar in Settings');
    process.exit(1);
  }

  if (!connection.syncTasks) {
    console.warn('⚠️  Task sync is disabled');
    console.log('   → Enable sync in Settings');
    process.exit(1);
  }

  // Check tasks with due dates
  const tasksWithDueDates = await prisma.task.findMany({
    where: { 
      userId,
      dueDate: { not: null }
    },
    orderBy: { dueDate: 'asc' },
    take: 5
  });

  console.log(`📋 Tasks with due dates: ${tasksWithDueDates.length}`);
  
  if (tasksWithDueDates.length === 0) {
    console.warn('⚠️  No tasks with due dates found');
    console.log('   → Create a task with a due date to test sync');
    process.exit(1);
  }

  console.log('\nSample tasks:');
  tasksWithDueDates.forEach((task, i) => {
    console.log(`   ${i + 1}. "${task.title}" - Due: ${task.dueDate?.toLocaleDateString()}`);
  });
  console.log();

  // Check existing sync items
  const syncItems = await prisma.googleCalendarSyncItem.findMany({
    where: { userId, localType: 'TASK' }
  });

  console.log(`🔗 Already synced events: ${syncItems.length}`);
  if (syncItems.length > 0) {
    console.log('\nSynced items:');
    syncItems.slice(0, 5).forEach((item, i) => {
      console.log(`   ${i + 1}. Task: ${item.localId} → Google Event: ${item.googleEventId}`);
    });
    console.log();
  }

  // Attempt sync
  console.log('🔄 Starting sync...\n');
  console.log('─'.repeat(60));
  
  try {
    const result = await syncGoogleCalendarTasks(userId);
    
    console.log('─'.repeat(60));
    console.log('\n✅ Sync completed successfully!\n');
    console.log('Results:');
    console.log(`   Created: ${result.created}`);
    console.log(`   Updated: ${result.updated}`);
    console.log(`   Deleted: ${result.deleted}`);
    console.log(`   Skipped: ${result.skipped}`);
    console.log(`   Total synced: ${result.synced}`);
    console.log();
    console.log('🎉 Check your Google Calendar now!');
  } catch (error: any) {
    console.log('─'.repeat(60));
    console.error('\n❌ Sync failed!\n');
    console.error('Error:', error.message);
    
    if (error.code === 'GOOGLE_CALENDAR_NOT_CONNECTED') {
      console.log('\n💡 Solution: Connect Google Calendar in Settings');
    } else if (error.code === 'GOOGLE_REFRESH_TOKEN_MISSING') {
      console.log('\n💡 Solution: Disconnect and reconnect Google Calendar');
      console.log('   Make sure to grant all permissions during OAuth flow');
    } else if (error.message.includes('Failed to create')) {
      console.log('\n💡 Possible issues:');
      console.log('   - Check OAuth scopes include calendar.events');
      console.log('   - Verify Calendar API is enabled in Google Cloud Console');
      console.log('   - Check API quotas');
    }
    
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
