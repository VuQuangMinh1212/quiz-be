/**
 * Import script: đọc tất cả JSON trong /data/imports → upsert vào DB
 *
 * Chạy thủ công:  docker compose exec backend npm run import
 * Hoặc khi mount file mới vào /data/imports rồi chạy lại lệnh trên.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const knex = require('knex');
const knexConfig = require('../../knexfile');

const db = knex(knexConfig[process.env.NODE_ENV || 'development']);
const IMPORT_DIR = path.join(__dirname, '../../data/imports');

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

async function importFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const json = JSON.parse(raw);
  const filename = path.basename(filePath);
  const course = path.relative(IMPORT_DIR, path.dirname(filePath)).split(path.sep)[0] || 'dva';

  // Hỗ trợ cả 2 dạng: { attemptAnswers: [...] } hoặc [...]
  const items = Array.isArray(json) ? json : json.attemptAnswers;

  if (!Array.isArray(items) || items.length === 0) {
    console.log(`  ⚠️  Không tìm thấy dữ liệu trong ${path.basename(filePath)}`);
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const item of items) {
    const {
      questionId,
      questionText,
      explanation,
      answers,
      correctAnswer,
      selectedAnswers,
      isCorrect,
      isFlagged,
    } = item;

    // 1. Upsert vào bảng questions (bỏ qua nếu đã tồn tại)
    const existing = await db('questions').where({ course, question_id: questionId }).first();

    if (!existing) {
      await db('questions').insert({
        course,
        question_id: questionId,
        question_text: questionText,
        explanation: explanation || null,
        answers: JSON.stringify(answers),
        correct_answer: JSON.stringify(correctAnswer),
        source_file: filename,
      });

      // 2. Seed lần thi gốc (attempt_number = 0) từ JSON
      await db('attempts').insert({
        course,
        question_id: questionId,
        selected_answers: JSON.stringify(selectedAnswers),
        is_correct: isCorrect,
        attempt_number: 0,
        is_flagged: isFlagged || false,
      });

      inserted++;
    } else {
      // Cập nhật source_file nếu chưa có
      if (!existing.source_file) {
        await db('questions').where({ course, question_id: questionId }).update({ source_file: filename });
      }
      skipped++;
    }
  }

  console.log(
    `  ✅ [${course}] ${path.basename(filePath)}: +${inserted} câu mới, bỏ qua ${skipped} câu trùng`
  );
}

async function main() {
  if (!fs.existsSync(IMPORT_DIR)) {
    console.error(`❌ Không tìm thấy thư mục: ${IMPORT_DIR}`);
    process.exit(1);
  }

  const files = collectJsonFiles(IMPORT_DIR);

  if (files.length === 0) {
    console.log('⚠️  Không có file JSON nào trong /data/imports');
    process.exit(0);
  }

  console.log(`🚀 Bắt đầu import ${files.length} file...\n`);

  for (const file of files) {
    try {
      await importFile(file);
    } catch (err) {
      console.error(`  ❌ Lỗi khi import ${file}:`, err.message);
    }
  }

  console.log('\n✅ Import hoàn tất!');
  await db.destroy();
}

main().catch((err) => {
  console.error('❌ Import thất bại:', err);
  process.exit(1);
});
