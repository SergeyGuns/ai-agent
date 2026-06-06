import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

export interface PdfPage {
  page: number;
  content: string;
}

/**
 * Извлекает текст из PDF файла
 */
export function extractPdfText(pdfPath: string): string {
  try {
    const result = execSync(`pdftotext "${pdfPath}" -`, {
      encoding: "utf-8",
      timeout: 30000,
    });
    return result;
  } catch (e: any) {
    throw new Error(`Failed to extract PDF text: ${e.message}`);
  }
}

/**
 * Извлекает текст из PDF по страницам
 */
export function extractPdfPages(pdfPath: string): PdfPage[] {
  try {
    const result = execSync(`pdftotext "${pdfPath}" -`, {
      encoding: "utf-8",
      timeout: 30000,
    });

    // Разбиваем по страницам (form feed character)
    const pages = result.split("\f");
    return pages
      .map((content, i) => ({ page: i + 1, content: content.trim() }))
      .filter((p) => p.content.length > 0);
  } catch (e: any) {
    throw new Error(`Failed to extract PDF pages: ${e.message}`);
  }
}

/**
 * Извлекает текст из конкретных страниц PDF
 */
export function extractPdfPageRange(pdfPath: string, startPage: number, endPage: number): string {
  try {
    const result = execSync(
      `pdftotext -f ${startPage} -l ${endPage} "${pdfPath}" -`,
      { encoding: "utf-8", timeout: 30000 }
    );
    return result.trim();
  } catch (e: any) {
    throw new Error(`Failed to extract PDF pages ${startPage}-${endPage}: ${e.message}`);
  }
}

/**
 * Получает метаданные PDF (количество страниц и т.д.)
 */
export function getPdfInfo(pdfPath: string): { pages: number; size: number } {
  try {
    const stats = fs.statSync(pdfPath);
    const result = execSync(`pdfinfo "${pdfPath}"`, {
      encoding: "utf-8",
      timeout: 10000,
    });

    const pagesMatch = result.match(/Pages:\s+(\d+)/);
    const pages = pagesMatch ? parseInt(pagesMatch[1]) : 0;

    return { pages, size: stats.size };
  } catch (e: any) {
    throw new Error(`Failed to get PDF info: ${e.message}`);
  }
}

/**
 * Разбивает текст PDF на чанки для RAG
 */
export function chunkPdfText(text: string, maxChunkSize: number = 2000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = "";

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Сохраняем перекрытие
      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + "\n\n" + para;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
