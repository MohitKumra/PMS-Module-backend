// backend/src/scripts/cleanup-orphaned-files.ts
// Run: npx ts-node src/scripts/cleanup-orphaned-files.ts
// Clears attachmentUrl/voiceNoteUrl fields that point to old filesystem paths
// (files that were lost during deployments on Render's ephemeral storage).

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Old filesystem URLs start with these patterns
const OLD_URL_PATTERNS = [
  'http://localhost:3001/uploads/',
  'https://pms-module-backend.onrender.com/uploads/',
  '/uploads/',
];

function isOldOrphanedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  // New database URLs start with /api/media/file/
  if (url.includes('/api/media/file/')) return false;
  // Check if it matches old patterns
  return OLD_URL_PATTERNS.some(pattern => url.includes(pattern));
}

async function main() {
  console.log('Scanning for orphaned file URLs...\n');

  // Check Notes
  const notesWithOrphans = await prisma.note.findMany({
    where: {
      OR: [
        { attachmentUrl: { not: null } },
        { voiceNoteUrl: { not: null } },
      ],
    },
    select: { id: true, attachmentUrl: true, voiceNoteUrl: true, title: true },
  });

  const orphanedNotes = notesWithOrphans.filter(
    n => isOldOrphanedUrl(n.attachmentUrl) || isOldOrphanedUrl(n.voiceNoteUrl)
  );

  console.log(`Notes with orphaned files: ${orphanedNotes.length}`);
  orphanedNotes.forEach(n => {
    console.log(`  - ${n.id} (${n.title || 'untitled'}):`);
    if (isOldOrphanedUrl(n.attachmentUrl)) console.log(`      attachmentUrl: ${n.attachmentUrl}`);
    if (isOldOrphanedUrl(n.voiceNoteUrl)) console.log(`      voiceNoteUrl: ${n.voiceNoteUrl}`);
  });

  // Check Tasks
  const tasksWithOrphans = await prisma.task.findMany({
    where: {
      OR: [
        { attachmentUrl: { not: null } },
        { voiceNoteUrl: { not: null } },
      ],
    },
    select: { id: true, attachmentUrl: true, voiceNoteUrl: true, title: true },
  });

  const orphanedTasks = tasksWithOrphans.filter(
    t => isOldOrphanedUrl(t.attachmentUrl) || isOldOrphanedUrl(t.voiceNoteUrl)
  );

  console.log(`\nTasks with orphaned files: ${orphanedTasks.length}`);
  orphanedTasks.forEach(t => {
    console.log(`  - ${t.id} (${t.title || 'untitled'}):`);
    if (isOldOrphanedUrl(t.attachmentUrl)) console.log(`      attachmentUrl: ${t.attachmentUrl}`);
    if (isOldOrphanedUrl(t.voiceNoteUrl)) console.log(`      voiceNoteUrl: ${t.voiceNoteUrl}`);
  });

  // Check Projects
  const projectsWithOrphans = await prisma.project.findMany({
    where: {
      OR: [
        { attachmentUrl: { not: null } },
        { voiceNoteUrl: { not: null } },
      ],
    },
    select: { id: true, attachmentUrl: true, voiceNoteUrl: true, name: true },
  });

  const orphanedProjects = projectsWithOrphans.filter(
    p => isOldOrphanedUrl(p.attachmentUrl) || isOldOrphanedUrl(p.voiceNoteUrl)
  );

  console.log(`\nProjects with orphaned files: ${orphanedProjects.length}`);
  orphanedProjects.forEach(p => {
    console.log(`  - ${p.id} (${p.name || 'untitled'}):`);
    if (isOldOrphanedUrl(p.attachmentUrl)) console.log(`      attachmentUrl: ${p.attachmentUrl}`);
    if (isOldOrphanedUrl(p.voiceNoteUrl)) console.log(`      voiceNoteUrl: ${p.voiceNoteUrl}`);
  });

  // Check Users (avatars)
  const usersWithOrphans = await prisma.user.findMany({
    where: { avatarUrl: { not: null } },
    select: { id: true, avatarUrl: true, email: true },
  });

  const orphanedUsers = usersWithOrphans.filter(u => isOldOrphanedUrl(u.avatarUrl));

  console.log(`\nUsers with orphaned avatars: ${orphanedUsers.length}`);
  orphanedUsers.forEach(u => {
    console.log(`  - ${u.id} (${u.email}): avatarUrl: ${u.avatarUrl}`);
  });

  const total = orphanedNotes.length + orphanedTasks.length + orphanedProjects.length + orphanedUsers.length;
  console.log(`\nTotal orphaned file references: ${total}`);

  if (total === 0) {
    console.log('No orphaned files found. Everything is clean!');
    await prisma.$disconnect();
    return;
  }

  // Ask for confirmation before clearing
  console.log('\nTo clear these orphaned references, run with --clear flag');
  if (process.argv.includes('--clear')) {
    console.log('\nClearing orphaned references...');

    // Clear notes
    for (const n of orphanedNotes) {
      await prisma.note.update({
        where: { id: n.id },
        data: {
          attachmentUrl: isOldOrphanedUrl(n.attachmentUrl) ? null : n.attachmentUrl,
          voiceNoteUrl: isOldOrphanedUrl(n.voiceNoteUrl) ? null : n.voiceNoteUrl,
        },
      });
    }

    // Clear tasks
    for (const t of orphanedTasks) {
      await prisma.task.update({
        where: { id: t.id },
        data: {
          attachmentUrl: isOldOrphanedUrl(t.attachmentUrl) ? null : t.attachmentUrl,
          voiceNoteUrl: isOldOrphanedUrl(t.voiceNoteUrl) ? null : t.voiceNoteUrl,
        },
      });
    }

    // Clear projects
    for (const p of orphanedProjects) {
      await prisma.project.update({
        where: { id: p.id },
        data: {
          attachmentUrl: isOldOrphanedUrl(p.attachmentUrl) ? null : p.attachmentUrl,
          voiceNoteUrl: isOldOrphanedUrl(p.voiceNoteUrl) ? null : p.voiceNoteUrl,
        },
      });
    }

    // Clear users
    for (const u of orphanedUsers) {
      await prisma.user.update({
        where: { id: u.id },
        data: { avatarUrl: null },
      });
    }

    console.log('Done! All orphaned references cleared.');
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});