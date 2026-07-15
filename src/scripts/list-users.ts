/**
 * List all users in the system
 * Run with: npx tsx src/scripts/list-users.ts
 */

import { prisma } from '../lib/prismaClient';

async function listUsers() {
  console.log('\n=== Users in System ===\n');

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      googleId: true,
      _count: {
        select: {
          tasks: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (users.length === 0) {
    console.log('No users found.\n');
    return;
  }

  console.log(`Found ${users.length} user(s):\n`);

  users.forEach((user, index) => {
    console.log(`${index + 1}. ${user.email}`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Name: ${user.name || '(no name set)'}`);
    console.log(`   Google Connected: ${user.googleId ? '✓' : '✗'}`);
    console.log(`   Tasks: ${user._count.tasks}`);
    console.log(`   Created: ${user.createdAt.toISOString()}`);
    console.log('');
  });

  console.log('To diagnose a specific user, run:');
  console.log('  npx tsx src/scripts/diagnose-calendar.ts <userId>\n');
}

listUsers()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
