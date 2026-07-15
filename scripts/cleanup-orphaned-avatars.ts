import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prismaClient';

/**
 * Script to clean up orphaned avatar files that are no longer referenced by any user.
 * Run with: npx tsx scripts/cleanup-orphaned-avatars.ts
 */

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const AVATARS_ROOT = path.join(UPLOAD_ROOT, 'avatars');

async function findAllAvatarFiles(): Promise<Set<string>> {
  const files = new Set<string>();
  
  try {
    const userDirs = await fs.readdir(AVATARS_ROOT);
    
    for (const userDir of userDirs) {
      const userPath = path.join(AVATARS_ROOT, userDir);
      const stats = await fs.stat(userPath);
      
      if (stats.isDirectory()) {
        const avatarFiles = await fs.readdir(userPath);
        
        for (const file of avatarFiles) {
          const relativePath = `/uploads/avatars/${userDir}/${file}`;
          files.add(relativePath);
        }
      }
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('No avatars directory found. Nothing to clean up.');
      return files;
    }
    throw error;
  }
  
  return files;
}

async function findReferencedAvatars(): Promise<Set<string>> {
  const users = await prisma.user.findMany({
    where: {
      avatarUrl: {
        not: null,
      },
    },
    select: {
      avatarUrl: true,
    },
  });
  
  const referenced = new Set<string>();
  
  for (const user of users) {
    if (user.avatarUrl && user.avatarUrl.startsWith('/uploads/')) {
      referenced.add(user.avatarUrl);
    }
  }
  
  return referenced;
}

async function cleanupOrphanedFiles(dryRun: boolean = true): Promise<void> {
  console.log('🔍 Scanning for orphaned avatar files...\n');
  
  const allFiles = await findAllAvatarFiles();
  const referencedFiles = await findReferencedAvatars();
  
  const orphanedFiles = Array.from(allFiles).filter(file => !referencedFiles.has(file));
  
  console.log(`📊 Statistics:`);
  console.log(`   Total avatar files: ${allFiles.size}`);
  console.log(`   Referenced by users: ${referencedFiles.size}`);
  console.log(`   Orphaned files: ${orphanedFiles.length}\n`);
  
  if (orphanedFiles.length === 0) {
    console.log('✅ No orphaned files found. Your avatar storage is clean!');
    return;
  }
  
  console.log(`🗑️  Orphaned files to ${dryRun ? 'be deleted' : 'delete'}:`);
  
  let deletedCount = 0;
  let failedCount = 0;
  let totalSize = 0;
  
  for (const file of orphanedFiles) {
    const relativePath = file.replace(/^\/uploads\//, '');
    const absolutePath = path.join(UPLOAD_ROOT, relativePath);
    
    try {
      const stats = await fs.stat(absolutePath);
      const sizeKB = (stats.size / 1024).toFixed(2);
      totalSize += stats.size;
      
      console.log(`   - ${file} (${sizeKB} KB)`);
      
      if (!dryRun) {
        await fs.unlink(absolutePath);
        deletedCount++;
      }
    } catch (error: any) {
      console.error(`   ❌ Failed to delete ${file}: ${error.message}`);
      failedCount++;
    }
  }
  
  const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
  
  console.log(`\n📈 Summary:`);
  if (dryRun) {
    console.log(`   Would delete: ${orphanedFiles.length} files`);
    console.log(`   Would free up: ${totalSizeMB} MB`);
    console.log(`\n💡 Run with --execute flag to actually delete these files.`);
  } else {
    console.log(`   Successfully deleted: ${deletedCount} files`);
    console.log(`   Failed: ${failedCount} files`);
    console.log(`   Space freed: ${totalSizeMB} MB`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  
  if (!execute) {
    console.log('🚀 Running in DRY RUN mode (no files will be deleted)\n');
  } else {
    console.log('⚠️  Running in EXECUTE mode (files will be permanently deleted)\n');
  }
  
  try {
    await cleanupOrphanedFiles(!execute);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
