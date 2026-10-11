export type ClassRole = 'student' | 'cr' | 'gr';
export type Persona = ClassRole | 'master';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'removed';
export interface PublicConfig {
  appName: string;
  allowedEmailDomain: string;
  universityUrl: string;
  timezone: string;
  authMode: 'demo' | 'firebase';
  firebase: { apiKey: string; authDomain: string; projectId: string; appId: string } | null;
}
export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  username?: string | null;
  avatarVersion?: string | null;
  role: 'student' | 'master';
  status: string;
}
export interface ClassFields {
  name: string;
  program: string;
  semester: string | number;
  section: string;
  description: string;
}
export interface ClassSummary extends ClassFields {
  id: string;
  role: ClassRole;
  memberCount: number;
}
export interface ClassRequest extends ClassFields {
  id: string;
  status: RequestStatus;
  reviewNote?: string | null;
  createdAt: string;
}
export interface MeResponse {
  user: AppUser;
  classes: ClassSummary[];
  pendingMemberships: { id: string; classId: string; className: string; status: RequestStatus }[];
  classRequests: ClassRequest[];
}
export interface ClassDetail {
  class: ClassFields & { id: string; createdAt: string; memberCount: number };
  pagination: { limit: number; offset: number; membersTotal: number; pendingMembersTotal: number };
  myRole: ClassRole | 'master';
  members: {
    userId: string;
    email?: string;
    displayName: string;
    username?: string | null;
    avatarVersion?: string | null;
    role: ClassRole;
    status: string;
  }[];
  pendingMembers: {
    id: string;
    userId: string;
    email: string;
    displayName: string;
    createdAt: string;
  }[];
  invite: { expiresAt: string; active: boolean } | null;
}
export interface AdminOverview {
  pagination: {
    limit: number;
    offset: number;
    requestsTotal: number;
    usersTotal: number;
    classesTotal: number;
    auditTotal: number;
  };
  stats: { users: number; classes: number; pendingRequests: number };
  requests: (ClassRequest & { requester: Pick<AppUser, 'id' | 'email' | 'displayName'> })[];
  users: AppUser[];
  classes: (ClassFields & { id: string; memberCount: number })[];
  audit: { id: string; action: string; actorEmail: string; targetId: string; createdAt: string }[];
}
