const express = require('express');
const router = express.Router();

module.exports = (db) => {
  /**
   * GET /api/questions/wrong
   * Câu hỏi sai ở lần làm gần nhất
   */
  router.get('/wrong', async (req, res) => {
    try {
      const rows = await db.raw(`
        SELECT q.*, a.is_correct, a.selected_answers, a.attempt_number, a.created_at as last_attempt
        FROM questions q
        JOIN (
          SELECT DISTINCT ON (question_id)
            question_id, is_correct, selected_answers, attempt_number, created_at
          FROM attempts
          ORDER BY question_id, created_at DESC
        ) a ON a.question_id = q.question_id
        WHERE a.is_correct = false
        ORDER BY a.created_at ASC
      `);
      res.json({ data: rows.rows, total: rows.rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/questions/flagged
   * Câu đã được flag ⭐
   */
  router.get('/flagged', async (req, res) => {
    try {
      const rows = await db('questions').where({ is_flagged: true }).orderBy('id');
      res.json({ data: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/questions/sources
   * Danh sách các bộ đề (source_file)
   */
  router.get('/sources', async (req, res) => {
    try {
      const rows = await db('questions').distinct('source_file').orderBy('source_file');
      res.json({ data: rows.map((r) => r.source_file).filter(Boolean) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/questions/all-random
   * Tất cả câu hỏi theo thứ tự ngẫu nhiên (Ôn tổng hợp)
   */
  router.get('/all-random', async (req, res) => {
    try {
      const rows = await db.raw(`
        SELECT q.*,
          (SELECT is_correct FROM attempts
           WHERE question_id = q.question_id
           ORDER BY created_at DESC LIMIT 1) AS last_attempt_correct
        FROM questions q
        ORDER BY RANDOM()
      `);
      res.json({ data: rows.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/questions
   * Tất cả câu hỏi kèm stats, hỗ trợ ?source= filter
   */
  router.get('/', async (req, res) => {
    try {
      const { source } = req.query;
      const bindings = [];
      let whereClause = '';

      if (source) {
        whereClause = 'WHERE q.source_file = ?';
        bindings.push(source);
      }

      const rows = await db.raw(`
        SELECT
          q.*,
          COUNT(a.id)::int AS total_attempts,
          SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)::int AS correct_count,
          (SELECT is_correct FROM attempts
           WHERE question_id = q.question_id
           ORDER BY created_at DESC LIMIT 1) AS last_attempt_correct,
          (SELECT attempt_number FROM attempts
           WHERE question_id = q.question_id AND is_correct = true
           ORDER BY attempt_number ASC LIMIT 1) AS first_correct_attempt
        FROM questions q
        LEFT JOIN attempts a ON a.question_id = q.question_id
        ${whereClause}
        GROUP BY q.id
        ORDER BY q.id
      `, bindings);

      res.json({ data: rows.rows, total: rows.rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PATCH /api/questions/:questionId/flag
   * Toggle flag ⭐ trên câu hỏi
   */
  router.patch('/:questionId/flag', async (req, res) => {
    try {
      const question = await db('questions')
        .where({ question_id: req.params.questionId })
        .first();
      if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });

      const [updated] = await db('questions')
        .where({ question_id: req.params.questionId })
        .update({ is_flagged: !question.is_flagged })
        .returning('*');

      res.json({ data: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/questions/:questionId
   * Chi tiết 1 câu hỏi
   */
  router.get('/:questionId', async (req, res) => {
    try {
      const question = await db('questions')
        .where({ question_id: req.params.questionId })
        .first();
      if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });
      res.json({ data: question });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
