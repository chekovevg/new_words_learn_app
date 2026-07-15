export function resolveAuthTransition(loadedUserId, session) {
  const nextUserId = session?.user?.id;
  if (!nextUserId) return 'clear';
  if (loadedUserId === nextUserId) return 'reuse';
  return 'load';
}
