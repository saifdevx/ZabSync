export interface PageMeta {
  limit: number;
  offset: number;
  total: number;
}
export type SubjectColor = 'blue' | 'teal' | 'purple' | 'amber' | 'rose';
export interface Subject {
  id: string;
  classId: string;
  className: string;
  name: string;
  code: string;
  instructor: string;
  description: string;
  color: SubjectColor;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  canManage: boolean;
  resourceCount: number;
  announcementCount: number;
}
export interface Resource {
  id: string;
  classId: string;
  subjectId: string | null;
  className: string;
  subjectName: string | null;
  title: string;
  description: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  canManage: boolean;
  saved: boolean;
  storageState: string;
}
export interface Announcement {
  id: string;
  scope: 'global' | 'class' | 'subject';
  classId: string | null;
  subjectId: string | null;
  className: string | null;
  subjectName: string | null;
  title: string;
  body: string;
  priority: 'normal' | 'important' | 'urgent';
  pinned: boolean;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  canManage: boolean;
  saved: boolean;
  resources: Resource[];
}
export interface SubjectList {
  subjects: Subject[];
  pagination: PageMeta;
}
export interface ResourceListData {
  resources: Resource[];
  pagination: PageMeta;
  limits: { fileBytes: number; classBytes: number };
}
export interface AnnouncementListData {
  announcements: Announcement[];
  pagination: PageMeta;
}
export interface Notification {
  id: string;
  announcementId: string;
  title: string;
  body: string;
  scope: Announcement['scope'];
  classId: string | null;
  subjectId: string | null;
  priority: Announcement['priority'];
  createdAt: string;
  read: boolean;
}
export interface NotificationsData {
  notifications: Notification[];
  pagination: PageMeta;
  unreadCount: number;
}
