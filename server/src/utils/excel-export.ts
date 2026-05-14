import ExcelJS from "exceljs";
import { Response } from "express";

interface ColumnDefinition {
  header: string;
  key: string;
  width?: number;
  style?: "currency" | "percent" | "date" | "number";
}

interface ReportOptions {
  title: string;
  sheetName: string;
  columns: ColumnDefinition[];
  data: Record<string, unknown>[];
  filters?: Record<string, string>;
  summary?: Record<string, number | string>;
  userName?: string;
}

const HEADER_BG = "2563eb";
const ALT_ROW_BG = "f8fafc";
const SUMMARY_BG = "f1f5f9";
const DEFAULT_COL_WIDTH = 15;

const STYLE_FORMATS: Record<string, { numFmt: string; alignment: Partial<ExcelJS.Alignment> }> = {
  currency: { numFmt: "#,##0.00", alignment: { horizontal: "right" } },
  percent:  { numFmt: "0.00%",    alignment: { horizontal: "right" } },
  date:     { numFmt: "dd/mm/yyyy", alignment: { horizontal: "center" } },
  number:   { numFmt: "#,##0",    alignment: { horizontal: "right" } },
};

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "D1D5DB" } };
  return { top: side, left: side, bottom: side, right: side };
}

export class ExcelExporter {
  static async generateReport(options: ReportOptions): Promise<Buffer> {
    const { title, sheetName, columns, data, filters, summary, userName } = options;
    const colCount = columns.length;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Restaurant POS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(sheetName);

    // --- Row 1: Title ---
    const titleRow = sheet.getRow(1);
    titleRow.getCell(1).value = title;
    titleRow.getCell(1).font = { bold: true, size: 16 };
    if (colCount > 1) {
      sheet.mergeCells(1, 1, 1, colCount);
    }

    // --- Row 2: Generated date (+ user) ---
    const now = new Date();
    const dateStr = now.toLocaleDateString("es-NI");
    const timeStr = now.toLocaleTimeString("es-NI");
    let generatedText = `Generado: ${dateStr} ${timeStr}`;
    if (userName) {
      generatedText += ` | Usuario: ${userName}`;
    }
    const infoRow = sheet.getRow(2);
    infoRow.getCell(1).value = generatedText;
    infoRow.getCell(1).font = { size: 10, color: { argb: "6B7280" } };

    // --- Row 3: Filters ---
    if (filters && Object.keys(filters).length > 0) {
      const filterText = Object.entries(filters)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      const filterRow = sheet.getRow(3);
      filterRow.getCell(1).value = `Filtros: ${filterText}`;
      filterRow.getCell(1).font = { size: 10, italic: true, color: { argb: "6B7280" } };
    }

    // --- Row 4: blank separator ---
    // (left empty)

    // --- Row 5: Column headers ---
    const HEADER_ROW = 5;
    const headerRow = sheet.getRow(HEADER_ROW);
    columns.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = col.header;
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: HEADER_BG },
      };
      cell.border = thinBorder();
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    headerRow.height = 24;

    // --- Set column widths and keys ---
    sheet.columns = columns.map((col) => ({
      key: col.key,
      width: col.width ?? DEFAULT_COL_WIDTH,
    }));

    // --- Freeze panes at header row ---
    sheet.views = [{ state: "frozen", ySplit: HEADER_ROW }];

    // --- Auto-filter on header row ---
    sheet.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: HEADER_ROW, column: colCount },
    };

    // --- Data rows (row 6+) ---
    const DATA_START = HEADER_ROW + 1;
    data.forEach((record, rowIdx) => {
      const row = sheet.getRow(DATA_START + rowIdx);

      columns.forEach((col, colIdx) => {
        const cell = row.getCell(colIdx + 1);
        cell.value = record[col.key] as ExcelJS.CellValue;

        // Apply style formatting
        if (col.style && STYLE_FORMATS[col.style]) {
          const fmt = STYLE_FORMATS[col.style];
          cell.numFmt = fmt.numFmt;
          cell.alignment = fmt.alignment;
        }

        cell.border = thinBorder();
      });

      // Alternating row color
      if (rowIdx % 2 === 1) {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: ALT_ROW_BG },
          };
        });
      }
    });

    // --- Summary row ---
    if (summary && Object.keys(summary).length > 0) {
      const summaryRowIdx = DATA_START + data.length + 1; // +1 for blank separator
      const summaryRow = sheet.getRow(summaryRowIdx);

      columns.forEach((col, colIdx) => {
        const cell = summaryRow.getCell(colIdx + 1);

        if (col.key in summary) {
          cell.value = summary[col.key] as ExcelJS.CellValue;

          if (col.style && STYLE_FORMATS[col.style]) {
            const fmt = STYLE_FORMATS[col.style];
            cell.numFmt = fmt.numFmt;
            cell.alignment = fmt.alignment;
          }
        }

        cell.font = { bold: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: SUMMARY_BG },
        };
        cell.border = thinBorder();
      });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}

export function sendExcelResponse(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}
