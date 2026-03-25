export function stripBasePath(pathname: string, basePath: string): string {
  const normalizedBasePath = (basePath || '').replace(/\/+$/, '');
  if (!normalizedBasePath) return pathname;
  if (pathname === normalizedBasePath) return '/';
  if (pathname.startsWith(`${normalizedBasePath}/`)) {
    const stripped = pathname.slice(normalizedBasePath.length);
    return stripped || '/';
  }
  return pathname;
}
