import type { ClassSummary, MeResponse } from './types';

/** Rendering checks supplement the server; missing or unknown roles never grant controls. */
export function isMaster(me: MeResponse | null | undefined): boolean {
  return me?.user.status === 'active' && me.user.role === 'master';
}

export function enrolledClasses(me: MeResponse | null | undefined): ClassSummary[] {
  if (
    !me ||
    me.user.status !== 'active' ||
    me.user.role !== 'student' ||
    me.section?.needsResolution
  )
    return [];
  const classes = me.classes.filter(
    (entry) =>
      (entry.role === 'student' || entry.role === 'admin') &&
      (!me.section?.classId || entry.id === me.section.classId),
  );
  return classes.length > 1 ? [] : classes;
}

export function isClassAdmin(me: MeResponse | null | undefined, classId?: string | null): boolean {
  return (
    !!classId &&
    me?.user.status === 'active' &&
    me.user.role === 'student' &&
    enrolledClasses(me).some((entry) => entry.id === classId && entry.role === 'admin')
  );
}

export function canManageAcademic(
  me: MeResponse | null | undefined,
  classId: string | null | undefined,
  options: { offline: boolean; maintenance: boolean; ownerContext: boolean },
): boolean {
  if (options.offline) return false;
  if (isMaster(me)) return options.ownerContext;
  return !options.maintenance && isClassAdmin(me, classId);
}
