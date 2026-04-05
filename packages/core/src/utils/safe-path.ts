import path from 'path';

/**
 * Resolve a relative path within a workspace root, preventing path traversal attacks.
 * Works correctly on both Windows and Unix systems.
 * 
 * @param root - The workspace root directory (absolute path)
 * @param relativePath - The relative path to resolve
 * @returns The resolved absolute path
 * @throws Error if the path would traverse outside the workspace
 */
export function safePath(root: string, relativePath: string): string {
  // Normalize both paths to handle Windows/Unix differences
  const normalizedRoot = path.normalize(path.resolve(root));
  const resolved = path.normalize(path.resolve(root, relativePath));
  
  // Check if resolved path is within or equal to root
  // Must either be the root itself or start with root + separator
  const isWithinRoot = 
    resolved === normalizedRoot || 
    resolved.startsWith(normalizedRoot + path.sep);
  
  if (!isWithinRoot) {
    throw new PathTraversalError(relativePath, normalizedRoot);
  }
  
  return resolved;
}

/**
 * Check if a path is safe without throwing an error.
 * 
 * @param root - The workspace root directory
 * @param relativePath - The relative path to check
 * @returns true if the path is within the workspace
 */
export function isPathSafe(root: string, relativePath: string): boolean {
  try {
    safePath(root, relativePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Custom error for path traversal attempts.
 */
export class PathTraversalError extends Error {
  public readonly attemptedPath: string;
  public readonly workspaceRoot: string;

  constructor(attemptedPath: string, workspaceRoot: string) {
    super(`Path traversal denied: "${attemptedPath}" escapes workspace "${workspaceRoot}"`);
    this.name = 'PathTraversalError';
    this.attemptedPath = attemptedPath;
    this.workspaceRoot = workspaceRoot;
  }
}
