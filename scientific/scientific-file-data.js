import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const quoted = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';

// Bound advertised ZIP expansion before the spreadsheet library decompresses
// an XLSX file. XLS/OLE files are already bounded by the raw-upload byte limit.
function boundedArchive(buffer) {
  if (buffer.readUInt16LE(0) !== 0x4b50) return;
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('Excel archive has no valid directory');
  const entries = buffer.readUInt16LE(end + 10), offset = buffer.readUInt32LE(end + 16);
  if (entries > 4096 || entries === 65535) throw new Error('Excel archive exceeds the supported entry bound');
  let cursor = offset, expanded = 0;
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid Excel archive directory');
    expanded += buffer.readUInt32LE(cursor + 24);
    if (expanded > 80000000) throw new Error('Excel archive exceeds the 80 MB expanded-data bound');
    cursor += 46 + buffer.readUInt16LE(cursor + 28) + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
}

export async function normalizeWorkbook(buffer, originalPath, workspace) {
  if (buffer.length < 4) throw new Error('Excel file is empty or invalid');
  boundedArchive(buffer);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, cellNF: true, cellFormula: true, cellHTML: false });
  if (!workbook.SheetNames.length || workbook.SheetNames.length > 50) throw new Error('Excel workbook must contain between one and fifty worksheets');
  const sheets = []; let totalBytes = 0, totalCells = 0;
  for (let index = 0; index < workbook.SheetNames.length; index++) {
    const sheetName = workbook.SheetNames[index], sheet = workbook.Sheets[sheetName];
    const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    const rowCount = range ? range.e.r + 1 : 0, columnCount = range ? range.e.c + 1 : 0;
    totalCells += rowCount * columnCount;
    if (totalCells > 2000000) throw new Error('Excel workbook exceeds the two-million-cell normalization bound');
    const rows = []; let formulas = 0, uncachedFormulas = 0, dateFormattedCells = 0;
    for (let r = 0; r < rowCount; r++) {
      const values = [];
      for (let c = 0; c < columnCount; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell?.f) { formulas++; if (cell.v === undefined) uncachedFormulas++; }
        if (cell?.z && XLSX.SSF.is_date(cell.z)) dateFormattedCells++;
        values.push(cell?.v ?? '');
      }
      rows.push(values);
    }
    const csv = rows.map(row => row.map(quoted).join(',')).join('\n') + (rows.length ? '\n' : '');
    const bytes = Buffer.from(csv); totalBytes += bytes.length;
    if (totalBytes > 50000000) throw new Error('Normalized Excel data exceeds the 50 MB bound');
    const basename = path.basename(originalPath).replace(/\.[^.]+$/, '');
    const filename = `${basename}-sheet-${index + 1}.csv`, target = path.join(path.dirname(originalPath), filename);
    await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o400 });
    if (process.platform === 'linux' && workspace.uid && process.getuid?.() === 0) { await fs.chown(target, 0, workspace.uid); await fs.chmod(target, 0o440); }
    sheets.push({ sheet_name: sheetName, sheet_index: index + 1, name: filename, local_path: target, read_path: target,
      sha256: sha256(bytes), size_bytes: bytes.length, row_count: rowCount, column_count: columnCount,
      preview_rows: rows.slice(0, 8).map(row => row.slice(0, 32)), preview_columns_truncated: columnCount > 32,
      raw_workbook_sha256: sha256(buffer), original_filename: path.basename(originalPath),
      formula_cells: formulas, uncached_formula_cells: uncachedFormulas, date_formatted_cells: dateFormattedCells,
      merged_ranges: (sheet['!merges'] || []).map(value => XLSX.utils.encode_range(value)),
      lineage: 'Full used worksheet rectangle exported as quoted CSV from cached raw cell values; original workbook retained.',
      limitations: ['Formula cells are not recalculated; cached values may be stale and uncached formulas export blank.',
        'Numeric Excel dates remain serial numbers; consult date1904 and date-formatted-cell metadata before converting.',
        'Formatting, charts and macros are not interpreted; merged cells remain populated only where stored. The first row is not assumed to be a header.'] });
  }
  return { parser: 'SheetJS', parser_version: XLSX.version, raw_workbook_sha256: sha256(buffer),
    date1904: workbook.Workbook?.WBProps?.date1904 === true, worksheets: sheets, normalized_bytes: totalBytes };
}

export async function profileTabularFile(filename, executor, workspace, { delimiter = ',', signal } = {}) {
  const code = `library(jsonlite)
data <- read.table(${JSON.stringify(filename)},header=TRUE,sep=${JSON.stringify(delimiter)},quote="\\\"",comment.char="",check.names=FALSE,stringsAsFactors=FALSE,fill=FALSE)
columns <- lapply(seq_along(data),function(i){x<-data[[i]]; finite_values<-if(is.numeric(x))x[is.finite(x)] else numeric(); list(name=names(data)[i],type=class(x)[1],missing=sum(is.na(x)),nonmissing=sum(!is.na(x)),numeric_summary=if(length(finite_values))list(min=min(finite_values),max=max(finite_values),mean=mean(finite_values),sd=if(length(finite_values)>1)sd(finite_values) else NULL) else NULL)})
cat("POWER_AGENT_INPUT_PROFILE=",toJSON(list(rows=nrow(data),columns=ncol(data),variables=columns,preview=head(data,8),reader="base R read.table; first row treated as headers",delimiter=${JSON.stringify(delimiter)}),auto_unbox=TRUE,digits=15,na="null"),"\\n",sep="")`;
  const execution = await executor.executeRCode(code, { workspace, phase: 'input_preparation', timeout: 30000, signal });
  const line = String(execution.output || '').split(/\r?\n/).find(value => value.startsWith('POWER_AGENT_INPUT_PROFILE='));
  let profile = null;
  try { profile = JSON.parse(line?.slice('POWER_AGENT_INPUT_PROFILE='.length)); } catch { /* explicit failed parse below */ }
  return { success: execution.success === true && Boolean(profile), profile,
    execution: { code, code_sha256: sha256(code), success: execution.success === true, output: execution.output || '', stderr: execution.stderr || '',
      exitCode: execution.exitCode ?? null, timedOut: execution.timedOut === true, elapsed_ms: execution.executionTime || 0,
      scope: 'Observed preliminary data structure using this reader; not a scientific estimate, power result, missing-data decision, or assumption about the requested analysis.' } };
}
