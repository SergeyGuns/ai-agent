import { minimatch } from "minimatch";

export function matchesGlob(filePath: string, pattern: string): boolean {
  return minimatch(filePath, pattern);
}
