import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { CommittedItem } from '@kiswok/shared';
import ExcelJS from 'exceljs';
import { buildSheetRows } from './mapping.service';

const DATA_SHEETS = [
  'Basic Data',
  'Additional Descriptions',
  'Alternative Units of Measure',
  'Additional GTINs',
  'Warehouse Product',
  'Warehouse Product Storage Type',
  'Distribution Chains',
  'Tax Classification',
  'Plant Data',
  'Forecasting Data',
  'Storage Locations',
  'Production Resources Tools',
  'Inspection Setup Data',
  'MRP Area',
  'Valuation Data',
  'Valuation Current Period',
  'Valuation Future Price',
] as const;

/** Sheets that typically carry ZRAW migration rows */
const PRIMARY_EXPORT_SHEETS = [
  'Basic Data',
  'Distribution Chains',
  'Tax Classification',
  'Plant Data',
  'Storage Locations',
  'Valuation Data',
] as const;

/** First data row in SAP migration templates (1-based). Rows 1-8 are headers. */
const DATA_START_ROW = 9;

@Injectable()
export class GoldTemplateExporter {
  private templatePath(): string {
    const candidates = [
      path.resolve(process.cwd(), 'assets/templates/Gold_SAP_Template - ZRAW-v2.xml'),
      path.resolve(process.cwd(), '../../assets/templates/Gold_SAP_Template - ZRAW-v2.xml'),
      path.resolve(__dirname, '../../../../../assets/templates/Gold_SAP_Template - ZRAW-v2.xml'),
      path.resolve(__dirname, '../../../../../../assets/templates/Gold_SAP_Template - ZRAW-v2.xml'),
      path.resolve(process.cwd(), 'assets/templates/Gold_SAP_Template - ZRAW.xml'),
      path.resolve(process.cwd(), '../../assets/templates/Gold_SAP_Template - ZRAW.xml'),
      path.resolve(__dirname, '../../../../../assets/templates/Gold_SAP_Template - ZRAW.xml'),
      path.resolve(__dirname, '../../../../../../assets/templates/Gold_SAP_Template - ZRAW.xml'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(
      `Gold SAP template not found. Checked:\n${candidates.join('\n')}`,
    );
  }

  private collectPayload(
    items: CommittedItem[],
  ): Record<string, Record<string, string>[]> {
    const sheetPayload: Record<string, Record<string, string>[]> = {};
    for (const sheet of DATA_SHEETS) {
      sheetPayload[sheet] = [];
    }
    const seen = new Set<string>();
    for (const item of items) {
      const liveCode = String(item.source?.sap_item_code || '').trim();
      const product = String(item.answers.productNumber || '').trim();
      if (liveCode && product && liveCode === product) continue;
      const key = product.toUpperCase();
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const rowsBySheet = item.sheetRows
        ? this.normalizeCommitted(item)
        : buildSheetRows(item.answers);
      for (const [sheet, rows] of Object.entries(rowsBySheet)) {
        if (!sheetPayload[sheet]) sheetPayload[sheet] = [];
        sheetPayload[sheet].push(...rows);
      }
    }
    return sheetPayload;
  }

  /** SAP Migration Cockpit XML Spreadsheet 2003 (.xml) */
  exportBatch(items: CommittedItem[]): Buffer {
    // Keep SpreadsheetML as CRLF — SAP rejects LF-only XML.
    let xml = fs
      .readFileSync(this.templatePath())
      .toString('utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    const sheetPayload = this.collectPayload(items);
    let out = xml;
    for (const sheet of DATA_SHEETS) {
      out = this.replaceSheetData(out, sheet, sheetPayload[sheet] || []);
    }
    out = out.replace(/\n/g, '\r\n');
    return Buffer.from(out, 'utf8');
  }

  /**
   * Excel workbook (.xlsx) with the same primary migration sheets / columns.
   * Useful for review and for environments that prefer Excel over SpreadsheetML.
   */
  async exportBatchXlsx(items: CommittedItem[]): Promise<Buffer> {
    const xml = fs
      .readFileSync(this.templatePath())
      .toString('utf8')
      .replace(/\r\n/g, '\n');
    const sheetPayload = this.collectPayload(items);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Kiswok Internal V3';
    workbook.created = new Date();

    for (const sheetName of PRIMARY_EXPORT_SHEETS) {
      const meta = this.readSheetMeta(xml, sheetName);
      if (!meta) continue;
      const rows = sheetPayload[sheetName] || [];
      const ws = workbook.addWorksheet(sheetName, {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      // Row 1: technical field codes (SAP extractor style)
      ws.addRow(meta.fieldCodes.map((c) => c || ''));
      // Row 2: human labels from template header row 8
      ws.addRow(meta.labels.map((c) => c || ''));
      ws.getRow(1).font = { bold: true, size: 10 };
      ws.getRow(2).font = { italic: true, size: 9 };

      for (const row of rows) {
        const values = meta.fieldCodes.map((code) =>
          code && row[code] != null && row[code] !== '' ? row[code] : '',
        );
        // Skip completely empty rows
        if (!values.some((v) => String(v).trim() !== '')) continue;
        ws.addRow(values);
      }

      meta.fieldCodes.forEach((_, i) => {
        ws.getColumn(i + 1).width = Math.min(
          28,
          Math.max(10, String(meta.labels[i] || meta.fieldCodes[i] || '').length + 2),
        );
      });
    }

    // Summary sheet for operators
    const summary = workbook.addWorksheet('_Export_Summary');
    summary.addRow(['Generated At', new Date().toISOString()]);
    summary.addRow(['Item Count', items.length]);
    summary.addRow(['Format', 'XLSX (Excel) — mirror of gold SAP template columns']);
    summary.addRow([]);
    summary.addRow(['IcSoft Code', 'SAP Product Number', 'Plant(s)', 'Product Type']);
    for (const item of items) {
      const plants = (
        item.answers.valuationAreas?.length
          ? item.answers.valuationAreas
          : String(item.answers.plant || '')
              .split(/[,;]/)
              .map((s) => s.trim())
              .filter(Boolean)
      ).join(', ');
      summary.addRow([
        item.source?.IcsoftCode || item.answers.oldProductNumber,
        item.answers.productNumber,
        plants || item.answers.plant,
        item.answers.productType,
      ]);
    }

    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  private normalizeCommitted(item: CommittedItem): Record<string, Record<string, string>[]> {
    return buildSheetRows(item.answers);
  }

  private readSheetMeta(
    xml: string,
    sheetName: string,
  ): { fieldCodes: string[]; labels: string[] } | null {
    const wsOpen = new RegExp(
      `<Worksheet([^>]*ss:Name="${escapeRegExp(sheetName)}"[^>]*)>`,
    );
    const openMatch = wsOpen.exec(xml);
    if (!openMatch) return null;
    const start = openMatch.index;
    const end = xml.indexOf('</Worksheet>', start);
    if (end < 0) return null;
    const worksheet = xml.slice(start, end);
    const tableMatch = /<Table[^>]*>/.exec(worksheet);
    if (!tableMatch) return null;
    const tableStart = tableMatch.index! + tableMatch[0].length;
    const tableEnd = worksheet.indexOf('</Table>');
    const tableInner = worksheet.slice(tableStart, tableEnd);
    const rows: string[] = [];
    const rowRegex = /<Row\b[^>]*>[\s\S]*?<\/Row>/g;
    let match: RegExpExecArray | null;
    while ((match = rowRegex.exec(tableInner)) !== null) {
      rows.push(match[0]);
    }
    if (rows.length < 8) return null;
    return {
      fieldCodes: this.parseCellValues(rows[4]),
      labels: this.parseCellValues(rows[7]).map((v) =>
        v.replace(/\r?\n.*/s, '').trim(),
      ),
    };
  }

  private replaceSheetData(
    xml: string,
    sheetName: string,
    rows: Record<string, string>[],
  ): string {
    const wsOpen = new RegExp(
      `<Worksheet([^>]*ss:Name="${escapeRegExp(sheetName)}"[^>]*)>`,
    );
    const openMatch = wsOpen.exec(xml);
    if (!openMatch) return xml;

    const start = openMatch.index;
    const end = xml.indexOf('</Worksheet>', start);
    if (end < 0) return xml;

    let worksheet = xml.slice(start, end + '</Worksheet>'.length);
    const tableMatch = /<Table[^>]*>/.exec(worksheet);
    if (!tableMatch) return xml;

    const tableStartInWs = tableMatch.index!;
    const tableEndInWs = worksheet.indexOf('</Table>');
    if (tableEndInWs < 0) return xml;

    const tableOpenTag = tableMatch[0];
    const tableInner = worksheet.slice(
      tableStartInWs + tableOpenTag.length,
      tableEndInWs,
    );

    const fieldCodes = this.extractFieldCodes(tableInner);
    if (!fieldCodes.length) return xml;

    const { headerXml, cellStyles, defaultStyleId, headerRowCount } =
      this.splitHeaderAndData(tableInner, xml);
    const dataXml = rows
      .map((row) =>
        this.buildDataRow(fieldCodes, row, defaultStyleId, cellStyles),
      )
      .join('');

    const builtDataRowCount = (dataXml.match(/<Row\b/g) || []).length;
    const expandedRowCount = headerRowCount + builtDataRowCount;
    const expandedColCount =
      Number((/ss:ExpandedColumnCount="(\d+)"/.exec(tableOpenTag) || [])[1]) ||
      fieldCodes.length ||
      1;

    let tableOpen = tableOpenTag;
    if (/ss:ExpandedRowCount="\d+"/.test(tableOpen)) {
      tableOpen = tableOpen.replace(
        /ss:ExpandedRowCount="\d+"/,
        `ss:ExpandedRowCount="${expandedRowCount}"`,
      );
    } else {
      tableOpen = tableOpen.replace(
        '<Table',
        `<Table ss:ExpandedRowCount="${expandedRowCount}"`,
      );
    }

    const newTable = `${tableOpen}${headerXml}${dataXml}</Table>`;
    worksheet =
      worksheet.slice(0, tableStartInWs) +
      newTable +
      worksheet.slice(tableEndInWs + '</Table>'.length);

    // Critical for SAP MC: AutoFilter must match actual used rows (not stale R54…).
    worksheet = worksheet.replace(
      /<AutoFilter\s+x:Range="R\d+C\d+:R\d+C\d+"/g,
      `<AutoFilter x:Range="R8C1:R${Math.max(8, expandedRowCount)}C${expandedColCount}"`,
    );

    return xml.slice(0, start) + worksheet + xml.slice(end + '</Worksheet>'.length);
  }

  /**
   * Keep rows 1–8 as header. Style sampling must come from row 9+ only.
   * Blank gold templates have no data rows, so falling back to row 8 copies
   * C_HEADER* (locked) and Excel blocks edits — use an unlocked data style instead.
   */
  private splitHeaderAndData(
    tableInner: string,
    workbookXml: string,
  ): {
    headerXml: string;
    cellStyles: Map<number, string>;
    defaultStyleId: string;
    headerRowCount: number;
  } {
    const rowRegex = /<Row\b[^>]*>[\s\S]*?<\/Row>/g;
    const allRows: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = rowRegex.exec(tableInner)) !== null) {
      allRows.push(match[0]);
    }

    const headerRows = allRows.slice(0, DATA_START_ROW - 1);
    const dataSampleRows = allRows.slice(DATA_START_ROW - 1);
    const unlocked = this.collectUnlockedStyleIds(workbookXml);
    const fallbackStyleId = this.pickUnlockedDataStyle(unlocked);

    const cellStyles = new Map<number, string>();
    let defaultStyleId = fallbackStyleId;

    for (const sample of dataSampleRows) {
      const sampled = this.parseCellStyleIds(sample);
      if (!sampled.size) continue;
      for (const [col, styleId] of sampled) {
        if (unlocked.has(styleId) || !this.isLikelyHeaderStyle(styleId)) {
          cellStyles.set(col, styleId);
        }
      }
      const first = [...sampled.values()].find(
        (id) => unlocked.has(id) || !this.isLikelyHeaderStyle(id),
      );
      if (first) {
        defaultStyleId = unlocked.has(first) ? first : fallbackStyleId;
        break;
      }
    }

    // Prefer unlocked style even when a data sample used a locked id.
    if (!unlocked.has(defaultStyleId)) {
      defaultStyleId = fallbackStyleId;
    }
    for (const [col, styleId] of [...cellStyles.entries()]) {
      if (!unlocked.has(styleId) || this.isLikelyHeaderStyle(styleId)) {
        cellStyles.set(col, defaultStyleId);
      }
    }

    const firstRowIdx = tableInner.search(/<Row\b/);
    const preamble =
      firstRowIdx >= 0 ? tableInner.slice(0, firstRowIdx) : tableInner;

    return {
      headerXml: preamble + headerRows.join(''),
      cellStyles,
      defaultStyleId,
      headerRowCount: headerRows.length,
    };
  }

  /** Column index (1-based) → StyleID from a sample data row. */
  private parseCellStyleIds(rowXml: string): Map<number, string> {
    const out = new Map<number, string>();
    const cellRegex = /<Cell([^>]*)>/g;
    let col = 1;
    let m: RegExpExecArray | null;
    while ((m = cellRegex.exec(rowXml)) !== null) {
      const attrs = m[1];
      const idxMatch = /ss:Index="(\d+)"/.exec(attrs);
      if (idxMatch) col = Number(idxMatch[1]);
      const styleMatch = /ss:StyleID="([^"]+)"/.exec(attrs);
      if (styleMatch) out.set(col, styleMatch[1]);
      col += 1;
    }
    return out;
  }

  private collectUnlockedStyleIds(workbookXml: string): Set<string> {
    const unlocked = new Set<string>();
    const styleRegex = /<Style ss:ID="([^"]+)"[^>]*>([\s\S]*?)<\/Style>/g;
    let m: RegExpExecArray | null;
    while ((m = styleRegex.exec(workbookXml)) !== null) {
      const id = m[1];
      const body = m[2];
      if (/<Protection[^>]*ss:Protected="0"/.test(body)) {
        unlocked.add(id);
      }
    }
    return unlocked;
  }

  private isLikelyHeaderStyle(styleId: string): boolean {
    return /^C_HEADER/i.test(styleId) || /HEADER/i.test(styleId);
  }

  /**
   * Neutral unlocked data styles preferred over orange mandatory (FIELDMAND).
   * Blank ZRAW gold templates ship many s0xx styles with Protected="0".
   */
  private pickUnlockedDataStyle(unlocked: Set<string>): string {
    const preferred = [
      's035',
      's064',
      's016',
      's001',
      's002',
      's003',
      'FIELDMAND',
    ];
    for (const id of preferred) {
      if (unlocked.has(id)) return id;
    }
    for (const id of unlocked) {
      if (!this.isLikelyHeaderStyle(id)) return id;
    }
    // Last resort — still better than C_HEADER2 on blank templates.
    return 's035';
  }

  private extractFieldCodes(tableInner: string): string[] {
    const rowRegex = /<Row\b[^>]*>[\s\S]*?<\/Row>/g;
    const rows: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = rowRegex.exec(tableInner)) !== null) {
      rows.push(match[0]);
    }
    const fieldRow = rows[4];
    if (!fieldRow) return [];
    return this.parseCellValues(fieldRow);
  }

  private parseCellValues(rowXml: string): string[] {
    const cells: Array<{ index: number; value: string }> = [];
    const cellRegex =
      /<Cell([^>]*)>(?:[\s\S]*?<Data[^>]*>([\s\S]*?)<\/Data>)?[\s\S]*?<\/Cell>/g;
    let col = 1;
    let m: RegExpExecArray | null;
    while ((m = cellRegex.exec(rowXml)) !== null) {
      const attrs = m[1];
      const idxMatch = /ss:Index="(\d+)"/.exec(attrs);
      if (idxMatch) col = Number(idxMatch[1]);
      const raw = m[2] ?? '';
      cells.push({ index: col, value: decodeXml(raw) });
      col += 1;
    }
    const max = cells.reduce((n, c) => Math.max(n, c.index), 0);
    const out = Array.from({ length: max }, () => '');
    for (const c of cells) out[c.index - 1] = c.value;
    return out;
  }

  private buildDataRow(
    fieldCodes: string[],
    values: Record<string, string>,
    defaultStyleId: string,
    cellStyles?: Map<number, string>,
  ): string {
    const parts: string[] = [`<Row ss:AutoFitHeight="0">`];
    let lastWritten = 0;
    for (let i = 0; i < fieldCodes.length; i++) {
      const code = fieldCodes[i];
      const value = values[code];
      if (value === undefined || value === null || value === '') {
        continue;
      }
      const col = i + 1;
      const styleId = cellStyles?.get(col) || defaultStyleId;
      const indexAttr = col === lastWritten + 1 ? '' : ` ss:Index="${col}"`;
      parts.push(
        `<Cell${indexAttr} ss:StyleID="${styleId}"><Data ss:Type="String">${escapeXml(
          String(value),
        )}</Data></Cell>`,
      );
      lastWritten = col;
    }
    parts.push('</Row>');
    if (parts.length === 2) return '';
    return parts.join('');
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, '\n');
}
