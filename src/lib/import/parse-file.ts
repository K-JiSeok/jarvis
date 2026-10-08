import "server-only";

import { createHash } from "node:crypto";

import { readSheet } from "read-excel-file/node";

import { decodeText, detectFormat, excelCellToString, MAX_DATA_ROWS, MAX_FILE_BYTES, parseCsv, toTable, type FileFormat, type ParsedTable } from "./core";

/*
 * 업로드 파일 → ParsedTable (서버에서만). 셀 값은 모두 문자열로 바꾼다 — 수식은 실행하지 않고 저장된 값만 읽는다.
 * 지원: .csv (UTF-8 / EUC-KR, , · 탭 · ; 구분), .xlsx (첫 번째 시트). .xls(구형 바이너리)는 지원하지 않는다.
 */

export class ImportFileError extends Error {}

export interface ParsedFile {
  fileName: string;
  size: number;
  hash: string;
  format: FileFormat;
  encoding: string | null;
  table: ParsedTable;
}

export async function parseUploadedFile(file: File): Promise<ParsedFile> {
  if (!file || typeof file.arrayBuffer !== "function" || !file.name) throw new ImportFileError("파일을 선택하세요.");
  if (file.size === 0) throw new ImportFileError("빈 파일입니다.");
  if (file.size > MAX_FILE_BYTES) throw new ImportFileError(`파일이 너무 큽니다 (최대 ${MAX_FILE_BYTES / 1024 / 1024}MB).`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const format = detectFormat(file.name, bytes);
  if (typeof format !== "string") throw new ImportFileError(format.error);

  let encoding: string | null = null;
  let table: ParsedTable;
  if (format === "xlsx") {
    let grid: unknown[][];
    try {
      grid = (await readSheet(Buffer.from(bytes))) as unknown[][];
    } catch {
      throw new ImportFileError("엑셀 파일을 읽을 수 없습니다 (손상되었거나 암호가 걸린 파일).");
    }
    table = toTable(grid.map((r) => r.map(excelCellToString)));
  } else {
    const decoded = decodeText(bytes);
    encoding = decoded.encoding;
    table = toTable(parseCsv(decoded.text));
  }

  if (table.headers.length === 0) throw new ImportFileError("파일에 내용이 없습니다.");
  if (table.rows.length === 0) throw new ImportFileError("헤더 아래에 데이터 행이 없습니다.");
  if (table.rows.length > MAX_DATA_ROWS) {
    throw new ImportFileError(
      `행이 너무 많습니다 (${table.rows.length.toLocaleString("ko-KR")}행, 최대 ${MAX_DATA_ROWS.toLocaleString("ko-KR")}행). 파일을 나눠 올려 주세요.`,
    );
  }
  return { fileName: file.name.slice(0, 255), size: file.size, hash, format, encoding, table };
}
