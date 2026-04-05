import * as path from 'path';

/**
 * Validates and resolves a relative path to ensure it stays within a designated root directory.
 * Throws an error if path traversal is attempted.
 *
 * Handles:
 * - Path traversal via `..`
 * - Absolute paths in relativePath
 * - Windows drive letters (C:\, D:\, etc.)
 * - UNC paths (\\server\share)
 * - Mixed separators (/ and \)
 * - Unicode characters
 * - Paths with spaces
 * - Null bytes
 *
 * @param rootDir - The absolute path of the allowed root directory.
 * @param relativePath - The relative path to validate.
 * @returns The resolved, absolute, and safe path.
 * @throws Error if the path is outside the root directory.
 */
export function safePath(rootDir: string, relativePath: string): string {
  if (!rootDir || typeof rootDir !== 'string') {
    throw new Error('Root directory must be a non-empty string.');
  }

  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('Relative path must be a non-empty string.');
  }

  // Block null bytes (common injection technique)
  if (relativePath.includes('\0') || rootDir.includes('\0')) {
    throw new Error('Path traversal denied: null byte detected.');
  }

  // Normalize the root directory to a consistent format
  const normalizedRoot = path.resolve(rootDir);

  // On Windows, block attempts to use absolute paths from different drives
  if (process.platform === 'win32') {
    // Block UNC paths
    if (relativePath.startsWith('\\\\') || relativePath.startsWith('//')) {
      throw new Error(
        `Path traversal denied. Attempted to access UNC path '${relativePath}' which is outside the workspace root.`
      );
    }

    // Block absolute paths with drive letters (e.g., C:\, D:\)
    if (/^[a-zA-Z]:[/\\]/.test(relativePath)) {
      const relDrive = relativePath.charAt(0).toUpperCase();
      const rootDrive = normalizedRoot.charAt(0).toUpperCase();
      if (relDrive !== rootDrive || !path.resolve(relativePath).startsWith(normalizedRoot + path.sep)) {
        throw new Error(
          `Path traversal denied. Attempted to access '${relativePath}' which is outside the workspace root.`
        );
      }
    }
  } else {
    // On Unix, block absolute paths that don't start with the root
    if (relativePath.startsWith('/')) {
      const resolvedAbs = path.resolve(relativePath);
      if (!resolvedAbs.startsWith(normalizedRoot + path.sep) && resolvedAbs !== normalizedRoot) {
        throw new Error(
          `Path traversal denied. Attempted to access '${resolvedAbs}' which is outside the workspace root.`
        );
      }
    }
  }

  // Resolve the full path
  const resolvedPath = path.resolve(normalizedRoot, relativePath);

  // Ensure the resolved path starts with the root (plus separator) or IS the root
  if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(normalizedRoot + path.sep)) {
    throw new Error(
      `Path traversal denied. Attempted to access '${resolvedPath}' which is outside the workspace root.`
    );
  }

  return resolvedPath;
}
