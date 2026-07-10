// backend/src/services/team.service.ts
// Team management service with CRUD operations and member management

import { prisma } from '../lib/prismaClient';
import type {
  TeamDTO,
  CreateTeamRequest,
  UpdateTeamRequest,
  TeamMemberDTO,
  AddTeamMemberRequest,
} from '../types';

/**
 * Get all teams for a user (either created by them or they're a member of)
 */
export async function getUserTeams(userId: string): Promise<TeamDTO[]> {
  const teams = await prisma.team.findMany({
    where: {
      OR: [
        { createdBy: userId },
        { members: { some: { userId } } },
      ],
    },
    include: {
      members: true,
      projects: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    avatarUrl: t.avatarUrl,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    memberCount: t.members.length,
    projectCount: t.projects.length,
  }));
}

/**
 * Get a single team by ID
 */
export async function getTeamById(teamId: string, userId: string): Promise<TeamDTO | null> {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      OR: [
        { createdBy: userId },
        { members: { some: { userId } } },
      ],
    },
    include: {
      members: true,
      projects: true,
    },
  });

  if (!team) return null;

  return {
    id: team.id,
    name: team.name,
    description: team.description,
    avatarUrl: team.avatarUrl,
    createdBy: team.createdBy,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
    memberCount: team.members.length,
    projectCount: team.projects.length,
  };
}

/**
 * Create a new team
 */
export async function createTeam(userId: string, data: CreateTeamRequest): Promise<TeamDTO> {
  const team = await prisma.team.create({
    data: {
      name: data.name,
      description: data.description,
      avatarUrl: data.avatarUrl,
      createdBy: userId,
      // Automatically add creator as OWNER
      members: {
        create: {
          userId,
          role: 'OWNER',
        },
      },
    },
    include: {
      members: true,
      projects: true,
    },
  });

  return {
    id: team.id,
    name: team.name,
    description: team.description,
    avatarUrl: team.avatarUrl,
    createdBy: team.createdBy,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
    memberCount: team.members.length,
    projectCount: team.projects.length,
  };
}

/**
 * Update a team
 */
export async function updateTeam(
  teamId: string,
  userId: string,
  data: UpdateTeamRequest
): Promise<TeamDTO | null> {
  // Check if user has permission (must be OWNER or ADMIN)
  const membership = await prisma.teamMember.findFirst({
    where: { teamId, userId, role: { in: ['OWNER', 'ADMIN'] } },
  });

  if (!membership) return null;

  const team = await prisma.team.update({
    where: { id: teamId },
    data: {
      name: data.name,
      description: data.description,
      avatarUrl: data.avatarUrl,
    },
    include: {
      members: true,
      projects: true,
    },
  });

  return {
    id: team.id,
    name: team.name,
    description: team.description,
    avatarUrl: team.avatarUrl,
    createdBy: team.createdBy,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
    memberCount: team.members.length,
    projectCount: team.projects.length,
  };
}

/**
 * Delete a team
 */
export async function deleteTeam(teamId: string, userId: string): Promise<boolean> {
  // Only team owner can delete
  const team = await prisma.team.findFirst({
    where: { id: teamId, createdBy: userId },
  });

  if (!team) return false;

  await prisma.team.delete({ where: { id: teamId } });
  return true;
}

/**
 * Get team members
 */
export async function getTeamMembers(teamId: string, userId: string): Promise<TeamMemberDTO[]> {
  // Check if user is a member
  const hasAccess = await prisma.teamMember.findFirst({
    where: { teamId, userId },
  });

  if (!hasAccess) return [];

  const members = await prisma.teamMember.findMany({
    where: { teamId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          timezone: true,
          createdAt: true,
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  return members.map((m) => ({
    id: m.id,
    teamId: m.teamId,
    userId: m.userId,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
    user: {
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      timezone: m.user.timezone,
      createdAt: m.user.createdAt.toISOString(),
    },
  }));
}

/**
 * Add a member to a team
 */
export async function addTeamMember(
  teamId: string,
  requesterId: string,
  data: AddTeamMemberRequest
): Promise<TeamMemberDTO | null> {
  // Check if requester has permission (must be OWNER or ADMIN)
  const membership = await prisma.teamMember.findFirst({
    where: { teamId, userId: requesterId, role: { in: ['OWNER', 'ADMIN'] } },
  });

  if (!membership) return null;

  // Check if user already a member
  const existing = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: data.userId } },
  });

  if (existing) return null;

  const member = await prisma.teamMember.create({
    data: {
      teamId,
      userId: data.userId,
      role: data.role ?? 'MEMBER',
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          timezone: true,
          createdAt: true,
        },
      },
    },
  });

  return {
    id: member.id,
    teamId: member.teamId,
    userId: member.userId,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
    user: {
      id: member.user.id,
      email: member.user.email,
      name: member.user.name,
      avatarUrl: member.user.avatarUrl,
      timezone: member.user.timezone,
      createdAt: member.user.createdAt.toISOString(),
    },
  };
}

/**
 * Remove a member from a team
 */
export async function removeTeamMember(
  teamId: string,
  memberId: string,
  requesterId: string
): Promise<boolean> {
  // Check if requester has permission (must be OWNER or ADMIN)
  const membership = await prisma.teamMember.findFirst({
    where: { teamId, userId: requesterId, role: { in: ['OWNER', 'ADMIN'] } },
  });

  if (!membership) return false;

  await prisma.teamMember.delete({ where: { id: memberId } });
  return true;
}
