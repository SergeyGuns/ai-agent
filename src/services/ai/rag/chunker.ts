export interface TextChunk {
  content: string;
  lineStart: number;
  lineEnd: number;
}

export function chunkText(text: string, maxLines: number = 50): TextChunk[] {
  const lines = text.split("\n");
  const chunks: TextChunk[] = [];

  for (let i = 0; i < lines.length; i += maxLines) {
    const chunkLines = lines.slice(i, i + maxLines);
    chunks.push({
      content: chunkLines.join("\n"),
      lineStart: i + 1,
      lineEnd: i + chunkLines.length,
    });
  }

  return chunks;
}
