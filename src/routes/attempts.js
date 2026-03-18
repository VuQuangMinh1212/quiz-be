const express = require('express');
const router = express.Router();

module.exports = (db) => {
  /**
   * POST /api/attempts
   * Submit đáp án
   * Body: { questionId, selectedAnswers: [] }
   */
  router.post('/', async (req, res) => {
    try {
      const { questionId, selectedAnswers } = req.body;

      if (!questionId || !selectedAnswers) {
        return res.status(400).json({ error: 'Thiếu questionId hoặc selectedAnswers' });
      }

      // Lấy đáp án đúng
      const question = await db('questions')
        .where({ question_id: questionId })
        .first();

      if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });

      // So sánh đáp án (strip HTML để compare)
      const stripHtml = (str) => str.replace(/<[^>]*>/g, '').trim();
      const correctTexts = question.correct_answer.map(stripHtml).sort();
      const selectedTexts = selectedAnswers.map(stripHtml).sort();
      const isCorrect =
        correctTexts.length === selectedTexts.length &&
        correctTexts.every((v, i) => v === selectedTexts[i]);

      // Tính attempt_number tiếp theo
      const lastAttempt = await db('attempts')
        .where({ question_id: questionId })
        .max('attempt_number as max')
        .first();
      const attemptNumber = (lastAttempt?.max ?? -1) + 1;

      // Lưu vào DB
      const [attempt] = await db('attempts')
        .insert({
          question_id: questionId,
          selected_answers: JSON.stringify(selectedAnswers),
          is_correct: isCorrect,
          attempt_number: attemptNumber,
          is_flagged: false,
        })
        .returning('*');

      res.json({
        data: {
          ...attempt,
          is_correct: isCorrect,
          correct_answer: question.correct_answer,
          explanation: question.explanation,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/attempts/:questionId
   * Lấy toàn bộ lịch sử làm bài của 1 câu hỏi
   */
  router.get('/:questionId', async (req, res) => {
    try {
      const attempts = await db('attempts')
        .where({ question_id: req.params.questionId })
        .orderBy('attempt_number', 'asc');

      res.json({ data: attempts });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/attempts/stats/overview
   * Tổng quan: tổng câu, câu đã thuộc, câu chưa thuộc
   */
  router.get('/stats/overview', async (req, res) => {
    try {
      const stats = await db.raw(`
        SELECT
          COUNT(DISTINCT q.question_id)::int AS total_questions,
          COUNT(DISTINCT CASE WHEN latest.is_correct THEN q.question_id END)::int AS mastered,
          COUNT(DISTINCT CASE WHEN NOT latest.is_correct THEN q.question_id END)::int AS need_review
        FROM questions q
        LEFT JOIN (
          SELECT DISTINCT ON (question_id) question_id, is_correct
          FROM attempts
          ORDER BY question_id, created_at DESC
        ) latest ON latest.question_id = q.question_id
      `);

      res.json({ data: stats.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PATCH /api/attempts/:attemptId/flag
   * Đánh dấu / bỏ đánh dấu câu hỏi
   */
  router.patch('/:attemptId/flag', async (req, res) => {
    try {
      const attempt = await db('attempts')
        .where({ id: req.params.attemptId })
        .first();

      if (!attempt) return res.status(404).json({ error: 'Không tìm thấy' });

      const [updated] = await db('attempts')
        .where({ id: req.params.attemptId })
        .update({ is_flagged: !attempt.is_flagged })
        .returning('*');

      res.json({ data: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
