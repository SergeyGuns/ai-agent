export interface Chunk {
  content: string;
  startLine: number;
  endLine: number;
}

const IGNORE_DIRS = ["node_modules", ".git", "dist", ".next", "coverage"];

export function chunkCode(content: string, maxSize = 50): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];

  for (let i = 0; i < lines.length; i += maxSize) {
    const chunkLines = lines.slice(i, i + maxSize);
    if (chunkLines.length === 0) break;
    chunks.push({
      content: chunkLines.join("\n"),
      startLine: i + 1,
      endLine: i + chunkLines.length,
    });
  }

  return chunks;
}

export async function* walkFiles(
  dir: string,
  extensions: string[],
): AsyncGenerator<{ path: string; content: string }> {
  const { promises: fs } = await import("fs");
  const path = await import("path");

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORE_DIRS.includes(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* walkFiles(fullPath, extensions);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (extensions.includes(ext)) {
        try {
          const content = await fs.readFile(fullPath, "utf-8");
          yield { path: fullPath, content };
        } catch {
          // skip
        }
      }
    }
  }
}
