import { prisma } from '../src/lib/prismaClient';

async function main() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        avatarUrl: true,
      },
    });
    
    console.log('Users and their avatar URLs:');
    console.log(JSON.stringify(users, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
