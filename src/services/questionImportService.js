const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMPORT_DIR = path.join(__dirname, '../../data/imports');
const LOCK_KEY = 90551001;

function collectJsonFiles(dirPath, acc = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectJsonFiles(fullPath, acc);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function parseItems(rawJson) {
  const payload = JSON.parse(rawJson);
  const items = Array.isArray(payload) ? payload : payload?.attemptAnswers;
  if (!Array.isArray(items)) return [];
  return items.filter((item) => Number.isInteger(item?.questionId));
}

async function hasImportTables(db) {
  const [jobs, items] = await Promise.all([
    db.schema.hasTable('import_jobs'),
    db.schema.hasTable('import_job_items'),
  ]);
  return jobs && items;
}

async function createJob(db, options, filesTotal, enabled) {
  if (!enabled) return null;
  const [job] = await db('import_jobs')
    .insert({
      triggered_by: options.triggeredBy || 'manual',
      prune: !!options.prune,
      dry_run: !!options.dryRun,
      force: !!options.force,
      status: 'running',
      files_total: filesTotal,
    })
    .returning('*');
  return job;
}

async function getPreviousChecksum(db, course, sourceFile, enableLogs) {
  if (!enableLogs) return null;
  const row = await db('import_job_items')
    .where({ course, source_file: sourceFile })
    .whereNotNull('checksum_new')
    .orderBy('id', 'desc')
    .first('checksum_new');
  return row?.checksum_new || null;
}

async function writeJobItem(db, jobId, payload, enabled) {
  if (!enabled || !jobId) return;
  await db('import_job_items').insert({
    job_id: jobId,
    ...payload,
  });
}

async function processFile(db, filePath, options, enableLogs, jobId) {
  const filename = path.basename(filePath);
  const course = path.relative(IMPORT_DIR, path.dirname(filePath)).split(path.sep)[0] || 'dva';
  const raw = fs.readFileSync(filePath, 'utf-8');
  const nextChecksum = checksum(raw);
  const prevChecksum = await getPreviousChecksum(db, course, filename, enableLogs);
  const shouldSkipByChecksum = !options.force && prevChecksum && prevChecksum === nextChecksum;

  if (shouldSkipByChecksum) {
    const skippedPayload = {
      course,
      source_file: filename,
      status: 'skipped_unchanged',
      checksum_old: prevChecksum,
      checksum_new: nextChecksum,
      skipped: 1,
      total_items: 0,
    };
    await writeJobItem(db, jobId, skippedPayload, enableLogs);
    return { inserted: 0, updated: 0, deleted: 0, skipped: 1, seedSkipped: 0, failed: 0 };
  }

  let items;
  try {
    items = parseItems(raw);
  } catch (error) {
    const errorMessage = `JSON parse error: ${error.message}`;
    await writeJobItem(
      db,
      jobId,
      {
        course,
        source_file: filename,
        status: 'failed',
        checksum_old: prevChecksum,
        checksum_new: nextChecksum,
        error_message: errorMessage,
      },
      enableLogs,
    );
    return { inserted: 0, updated: 0, deleted: 0, skipped: 0, seedSkipped: 0, failed: 1 };
  }

  if (items.length === 0) {
    await writeJobItem(
      db,
      jobId,
      {
        course,
        source_file: filename,
        status: 'empty',
        checksum_old: prevChecksum,
        checksum_new: nextChecksum,
        skipped: 1,
        total_items: 0,
      },
      enableLogs,
    );
    return { inserted: 0, updated: 0, deleted: 0, skipped: 1, seedSkipped: 0, failed: 0 };
  }

  if (options.dryRun) {
    await writeJobItem(
      db,
      jobId,
      {
        course,
        source_file: filename,
        status: 'dry_run',
        checksum_old: prevChecksum,
        checksum_new: nextChecksum,
        total_items: items.length,
      },
      enableLogs,
    );
    return { inserted: 0, updated: 0, deleted: 0, skipped: 0, seedSkipped: 0, failed: 0 };
  }

  try {
    const result = await db.transaction(async (trx) => {
      const importedIds = new Set();
      let inserted = 0;
      let updated = 0;
      let seedSkipped = 0;
      let deleted = 0;

      const questionIds = items.map((item) => item.questionId);
      const existingRows = await trx('questions')
        .select('question_id')
        .where({ course })
        .whereIn('question_id', questionIds);
      const existingSet = new Set(existingRows.map((r) => r.question_id));

      for (const item of items) {
        importedIds.add(item.questionId);
        const payload = {
          course,
          question_id: item.questionId,
          question_text: item.questionText,
          explanation: item.explanation || null,
          answers: JSON.stringify(item.answers || []),
          correct_answer: JSON.stringify(item.correctAnswer || []),
          source_file: filename,
        };

        await trx('questions')
          .insert(payload)
          .onConflict(['course', 'question_id'])
          .merge(payload);

        if (existingSet.has(item.questionId)) {
          updated += 1;
        } else {
          inserted += 1;
          if (typeof item.isCorrect === 'boolean' && Array.isArray(item.selectedAnswers)) {
            await trx('attempts').insert({
              course,
              question_id: item.questionId,
              selected_answers: JSON.stringify(item.selectedAnswers),
              is_correct: item.isCorrect,
              attempt_number: 0,
              is_flagged: !!item.isFlagged,
            });
          } else {
            seedSkipped += 1;
          }
        }
      }

      if (options.prune) {
        const existingSourceQuestions = await trx('questions')
          .select('question_id')
          .where({ course, source_file: filename });

        const idsToDelete = existingSourceQuestions
          .map((row) => row.question_id)
          .filter((id) => !importedIds.has(id));

        if (idsToDelete.length > 0) {
          await trx('attempts').where({ course }).whereIn('question_id', idsToDelete).del();
          deleted = await trx('questions')
            .where({ course, source_file: filename })
            .whereIn('question_id', idsToDelete)
            .del();
        }
      }

      return {
        inserted,
        updated,
        deleted,
        skipped: 0,
        seedSkipped,
      };
    });

    await writeJobItem(
      db,
      jobId,
      {
        course,
        source_file: filename,
        status: 'success',
        checksum_old: prevChecksum,
        checksum_new: nextChecksum,
        inserted: result.inserted,
        updated: result.updated,
        deleted: result.deleted,
        skipped: result.skipped,
        seed_skipped: result.seedSkipped,
        total_items: items.length,
      },
      enableLogs,
    );
    return { ...result, failed: 0 };
  } catch (error) {
    await writeJobItem(
      db,
      jobId,
      {
        course,
        source_file: filename,
        status: 'failed',
        checksum_old: prevChecksum,
        checksum_new: nextChecksum,
        total_items: items.length,
        error_message: error.message,
      },
      enableLogs,
    );
    return { inserted: 0, updated: 0, deleted: 0, skipped: 0, seedSkipped: 0, failed: 1 };
  }
}

async function updateJob(db, jobId, patch, enabled) {
  if (!enabled || !jobId) return;
  await db('import_jobs').where({ id: jobId }).update(patch);
}

async function runImportJob(db, options = {}) {
  if (!fs.existsSync(IMPORT_DIR)) {
    throw new Error(`Không tìm thấy thư mục import: ${IMPORT_DIR}`);
  }

  const files = collectJsonFiles(IMPORT_DIR);
  if (files.length === 0) {
    return {
      status: 'success',
      filesTotal: 0,
      filesProcessed: 0,
      filesFailed: 0,
      inserted: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      seedSkipped: 0,
      results: [],
    };
  }

  const lockRow = await db.raw('SELECT pg_try_advisory_lock(?) AS locked', [LOCK_KEY]);
  const lockAcquired = !!lockRow?.rows?.[0]?.locked;
  if (!lockAcquired) {
    throw new Error('Một tiến trình import khác đang chạy. Vui lòng thử lại sau.');
  }

  const enableLogs = await hasImportTables(db);
  const job = await createJob(db, options, files.length, enableLogs);

  const summary = {
    status: 'success',
    filesTotal: files.length,
    filesProcessed: 0,
    filesFailed: 0,
    inserted: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    seedSkipped: 0,
  };

  const results = [];
  try {
    for (const filePath of files) {
      const fileResult = await processFile(db, filePath, options, enableLogs, job?.id);
      summary.filesProcessed += 1;
      summary.filesFailed += fileResult.failed;
      summary.inserted += fileResult.inserted;
      summary.updated += fileResult.updated;
      summary.deleted += fileResult.deleted;
      summary.skipped += fileResult.skipped;
      summary.seedSkipped += fileResult.seedSkipped;
      results.push({ file: path.basename(filePath), ...fileResult });
    }

    if (summary.filesFailed > 0) {
      summary.status = 'partial_success';
    }

    await updateJob(
      db,
      job?.id,
      {
        status: summary.status,
        files_processed: summary.filesProcessed,
        files_failed: summary.filesFailed,
        inserted: summary.inserted,
        updated: summary.updated,
        deleted: summary.deleted,
        skipped: summary.skipped,
        seed_skipped: summary.seedSkipped,
        finished_at: db.fn.now(),
      },
      enableLogs,
    );

    return { ...summary, jobId: job?.id || null, results };
  } catch (error) {
    await updateJob(
      db,
      job?.id,
      {
        status: 'failed',
        error_message: error.message,
        finished_at: db.fn.now(),
      },
      enableLogs,
    );
    throw error;
  } finally {
    await db.raw('SELECT pg_advisory_unlock(?)', [LOCK_KEY]);
  }
}

module.exports = {
  IMPORT_DIR,
  collectJsonFiles,
  runImportJob,
};
