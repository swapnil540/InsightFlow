const { parse } = require('csv-parse/sync');
const Feedback = require('../models/feedback');
const Analysis = require('../models/analysis');
const { CATEGORY_VALUES, SOURCE_VALUES } = require('./filters');
const { analyzeMany } = require('./analysisService');
const { normalizeText, textHash } = require('./textHash');

const MAX_IMPORT_ROWS = 10000;
const MAX_TEXT_LENGTH = 1000;
const TEXT_HEADERS = ['review', 'text', 'feedback', 'comment', 'message'];

function normalizeHeader(header) {
  return String(header || '').replace(/^\uFEFF/, '').trim().toLowerCase();
}

function detectColumn(headers, aliases) {
  const index = headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
  return index < 0 ? null : { name: String(headers[index]).trim(), index };
}

function normalizeEnum(value, allowedValues) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return allowedValues.find((item) => item.toLowerCase() === clean.toLowerCase()) || null;
}

function parseCsvDate(value) {
  const clean = String(value || '').trim();
  if (!clean) return null;
  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseImportCsv(input) {
  const csvText = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const records = parse(csvText, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: false,
    max_record_size: 1024 * 1024,
  });
  if (!records.length) throw new Error('The CSV file is empty.');

  const headers = records[0].map((header) => String(header || '').replace(/^\uFEFF/, '').trim());
  const mapping = {
    text: detectColumn(headers, TEXT_HEADERS),
    category: detectColumn(headers, ['category']),
    source: detectColumn(headers, ['source']),
    date: detectColumn(headers, ['date']),
  };
  if (!mapping.text) throw new Error('Add a text column named review, text, feedback, comment, or message.');

  const dataRows = records.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) throw new Error(`The CSV can contain at most ${MAX_IMPORT_ROWS.toLocaleString()} rows.`);
  const validRows = [];
  const skippedRows = [];
  const seenHashes = new Set();
  let duplicateCount = 0;

  dataRows.forEach((cells, index) => {
    const line = index + 2;
    const getCell = (column) => column ? String(cells[column.index] ?? '').trim() : '';
    if (!cells.some((cell) => String(cell ?? '').trim())) {
      skippedRows.push({ line, reasons: ['empty'] });
      return;
    }

    const text = normalizeText(getCell(mapping.text));
    const reasons = [];
    if (!text) reasons.push('empty');
    else if (text.length < 5) reasons.push('too_short');
    if (text.length > MAX_TEXT_LENGTH) reasons.push('too_long');

    const categoryValue = getCell(mapping.category);
    const category = normalizeEnum(categoryValue, CATEGORY_VALUES);
    if (category === null) reasons.push('invalid_category');

    const sourceValue = getCell(mapping.source);
    const normalizedSource = normalizeEnum(sourceValue, SOURCE_VALUES);
    if (normalizedSource === null) reasons.push('invalid_source');

    const dateValue = getCell(mapping.date);
    const date = parseCsvDate(dateValue);
    if (date === undefined) reasons.push('bad_date');

    if (reasons.length) {
      skippedRows.push({ line, reasons });
      return;
    }

    const hash = textHash(text);
    if (seenHashes.has(hash)) duplicateCount += 1;
    seenHashes.add(hash);
    validRows.push({
      line,
      text,
      textHash: hash,
      category: category || '',
      source: normalizedSource || 'Review',
      sourceDefaulted: !normalizedSource,
      date,
    });
  });

  const skippedByReason = {};
  for (const skipped of skippedRows) {
    for (const reason of skipped.reasons) skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
  }
  return {
    totalRows: dataRows.length,
    validRows,
    skippedRows,
    skippedCount: skippedRows.length,
    skippedByReason,
    duplicateCount,
    uniqueTextCount: seenHashes.size,
    mapping: Object.fromEntries(Object.entries(mapping).map(([key, column]) => [key, column?.name || null])),
  };
}

async function prepareImportPreview(input) {
  const parsed = parseImportCsv(input);
  const hashes = [...new Set(parsed.validRows.map((row) => row.textHash))];
  let existingHashes = [];
  let cachedHashes = [];
  if (hashes.length) {
    if (Feedback.db.readyState !== 1 || Analysis.db.readyState !== 1) {
      throw new Error('Database is not connected. Reconnect and retry the CSV preview.');
    }
    [existingHashes, cachedHashes] = await Promise.all([
      Feedback.distinct('textHash', { textHash: { $in: hashes } }),
      Analysis.find({ textHash: { $in: hashes } }).select('textHash').lean(),
    ]);
  }
  const cachedHashSet = new Set(cachedHashes.map((item) => item.textHash));
  const previewId = require('./importStore').storeImport(parsed.validRows, {
    expectedNewAnalysisCount: hashes.filter((hash) => !cachedHashSet.has(hash)).length,
    skippedCount: parsed.skippedCount,
  });
  return {
    ...parsed,
    previewId,
    existingTextCount: existingHashes.length,
    newAnalysisCount: hashes.filter((hash) => !cachedHashSet.has(hash)).length,
    previewRows: parsed.validRows.slice(0, 10),
  };
}

function makeImportBatchId(now = new Date()) {
  const isoMinute = now.toISOString().slice(0, 16);
  const timestamp = `${isoMinute.slice(0, 10).replace(/-/g, '')}-${isoMinute.slice(11, 16).replace(':', '')}`;
  const suffix = require('crypto').randomBytes(2).toString('hex');
  return `imp-${timestamp}-${suffix}`;
}

async function confirmImport(storedRows) {
  const uniqueRows = new Map();
  for (const row of storedRows) if (!uniqueRows.has(row.textHash)) uniqueRows.set(row.textHash, row);
  const analysesByHash = new Map();
  let newAnalysisCount = 0;
  const uniqueList = [...uniqueRows.values()];
  const results = await analyzeMany(uniqueList.map((row) => row.text));
  let lowConfidenceCount = 0;
  uniqueList.forEach((row, index) => {
    const result = results[index];
    analysesByHash.set(row.textHash, result.analysis);
    if (!result.fromCache) newAnalysisCount += 1;
    if (result.notAnalyzed || result.confidence < 0.5) lowConfidenceCount += 1;
  });

  const importBatch = makeImportBatchId();
  const now = new Date();
  const documents = storedRows.map((row) => {
    const analysis = analysesByHash.get(row.textHash);
    const topic = require('../config/taxonomy').find((item) => item.key === analysis.topic);
    return {
      text: row.text,
      textHash: row.textHash,
      originalCategory: row.category || topic.parentCategory,
      source: row.source,
      createdAt: row.date || now,
      isSimulated: false,
      analysis,
      importBatch,
    };
  });

  let insertedCount = 0;
  for (let offset = 0; offset < documents.length; offset += 1000) {
    const result = await Feedback.insertMany(documents.slice(offset, offset + 1000));
    insertedCount += result.length;
  }
  return {
    importBatch,
    insertedCount,
    skippedCount: 0,
    newAnalysisCount,
    uniqueTextCount: uniqueRows.size,
    lowConfidenceCount,
  };
}

module.exports = {
  MAX_IMPORT_ROWS,
  parseImportCsv,
  prepareImportPreview,
  confirmImport,
  makeImportBatchId,
};
