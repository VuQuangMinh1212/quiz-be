const express = require('express');
const router = express.Router();

module.exports = (db) => {
  const getCourse = (req) => String(req.query.course || 'dva').trim().toLowerCase();

  const topicPatterns = [
    { topic: 'IAM', pattern: /\b(iam|identity and access management|role|policy|permission|sts)\b/i },
    { topic: 'Lambda', pattern: /\b(lambda|serverless|cold start)\b/i },
    { topic: 'DynamoDB', pattern: /\b(dynamodb|dax|partition key|sort key|gsi|lsi)\b/i },
    { topic: 'S3', pattern: /\b(s3|bucket|object storage|lifecycle rule)\b/i },
    { topic: 'EC2', pattern: /\b(ec2|eip|ami|instance store|ebs)\b/i },
    { topic: 'VPC', pattern: /\b(vpc|subnet|route table|nat gateway|internet gateway|security group|network acl|endpoint)\b/i },
    { topic: 'RDS/Aurora', pattern: /\b(rds|aurora|read replica|multi-az|db cluster|database)\b/i },
    { topic: 'CloudFront', pattern: /\b(cloudfront|cdn|edge location|origin access)\b/i },
    { topic: 'Route 53', pattern: /\b(route\s*53|hosted zone|dns|health check|latency routing|failover routing)\b/i },
    { topic: 'SQS/SNS', pattern: /\b(sqs|sns|queue|topic|fanout|dlq)\b/i },
    { topic: 'Kinesis', pattern: /\b(kinesis|firehose|data stream|shard)\b/i },
    { topic: 'API Gateway', pattern: /\b(api gateway|rest api|http api|websocket api)\b/i },
    { topic: 'CloudWatch', pattern: /\b(cloudwatch|metric|alarm|log group|log stream|insight)\b/i },
    { topic: 'CloudFormation', pattern: /\b(cloudformation|stack|change set|template)\b/i },
    { topic: 'ECS/EKS', pattern: /\b(ecs|eks|fargate|kubernetes|task definition|service discovery)\b/i },
    { topic: 'ELB/Auto Scaling', pattern: /\b(alb|nlb|elb|autoscaling|auto scaling|target group)\b/i },
    { topic: 'Security/KMS', pattern: /\b(kms|encryption|cmk|key policy|secrets manager|parameter store|waf|shield)\b/i },
  ];

  const detectTopics = (text) => {
    const matched = topicPatterns
      .filter(({ pattern }) => pattern.test(text))
      .map(({ topic }) => topic);
    return matched.length > 0 ? [...new Set(matched)] : ['Other'];
  };

  /**
   * GET /api/questions/wrong
   * Câu hỏi sai ở lần làm gần nhất
   */
  router.get('/wrong', async (req, res) => {
    try {
      const course = getCourse(req);
      const rows = await db.raw(`
        SELECT q.*, a.is_correct, a.selected_answers, a.attempt_number, a.created_at as last_attempt
        FROM questions q
        JOIN (
          SELECT DISTINCT ON (course, question_id)
            course, question_id, is_correct, selected_answers, attempt_number, created_at
          FROM attempts
          ORDER BY course, question_id, created_at DESC
        ) a ON a.question_id = q.question_id AND a.course = q.course
        WHERE q.course = ?
          AND a.course = ?
          AND a.is_correct = false
        ORDER BY a.created_at ASC
      `, [course, course]);
      res.json({ data: rows.rows, total: rows.rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/questions/weak-topics
   * Nhóm các câu sai theo chủ đề/keyword để biết topic yếu
   */
  router.get('/weak-topics', async (req, res) => {
    try {
      const course = getCourse(req);
      const rows = await db.raw(`
        SELECT q.question_id, q.question_text, q.explanation
        FROM questions q
        JOIN (
          SELECT DISTINCT ON (course, question_id)
            course, question_id, is_correct, created_at
          FROM attempts
          ORDER BY course, question_id, created_at DESC
        ) a ON a.question_id = q.question_id AND a.course = q.course
        WHERE q.course = ?
          AND a.course = ?
          AND a.is_correct = false
      `, [course, course]);

      const questions = rows.rows || [];
      const topicQuestionIds = {};

      for (const q of questions) {
        const combined = `${q.question_text || ''} ${q.explanation || ''}`;
        const topics = detectTopics(combined);
        for (const topic of topics) {
          if (!topicQuestionIds[topic]) topicQuestionIds[topic] = new Set();
          topicQuestionIds[topic].add(q.question_id);
        }
      }

      const topics = Object.entries(topicQuestionIds)
        .map(([topic, questionIdSet]) => {
          const question_ids = [...questionIdSet];
          const wrong_count = question_ids.length;
          return {
          topic,
          wrong_count,
          question_ids,
          percentage: questions.length > 0 ? Math.round((wrong_count / questions.length) * 100) : 0,
          };
        })
        .sort((a, b) => b.wrong_count - a.wrong_count)
        .slice(0, 8);

      res.json({
        data: {
          course,
          total_wrong: questions.length,
          topics,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/questions/courses
   * Danh sách course hiện có
   */
  router.get('/courses', async (req, res) => {
    try {
      const rows = await db('questions').distinct('course').orderBy('course');
      res.json({ data: rows.map((r) => r.course).filter(Boolean) });
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
      const course = getCourse(req);
      const rows = await db('questions').where({ course, is_flagged: true }).orderBy('id');
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
      const course = getCourse(req);
      const rows = await db('questions').where({ course }).distinct('source_file').orderBy('source_file');
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
      const course = getCourse(req);
      const rows = await db.raw(`
        SELECT q.*,
          (SELECT is_correct FROM attempts
           WHERE question_id = q.question_id AND course = q.course
           ORDER BY created_at DESC LIMIT 1) AS last_attempt_correct
        FROM questions q
        WHERE q.course = ?
        ORDER BY RANDOM()
      `, [course]);
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
      const course = getCourse(req);
      const { source } = req.query;
      const bindings = [course];
      let sourceClause = '';

      if (source) {
        sourceClause = 'AND q.source_file = ?';
        bindings.push(source);
      }

      const rows = await db.raw(`
        SELECT
          q.*,
          COUNT(a.id)::int AS total_attempts,
          SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)::int AS correct_count,
          (SELECT is_correct FROM attempts
           WHERE question_id = q.question_id AND course = q.course
           ORDER BY created_at DESC LIMIT 1) AS last_attempt_correct,
          (SELECT attempt_number FROM attempts
           WHERE question_id = q.question_id AND course = q.course AND is_correct = true
           ORDER BY attempt_number ASC LIMIT 1) AS first_correct_attempt
        FROM questions q
        LEFT JOIN attempts a ON a.question_id = q.question_id AND a.course = q.course
        WHERE q.course = ?
        ${sourceClause}
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
      const course = getCourse(req);
      const question = await db('questions')
        .where({ course, question_id: req.params.questionId })
        .first();
      if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });

      const [updated] = await db('questions')
        .where({ course, question_id: req.params.questionId })
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
      const course = getCourse(req);
      const question = await db('questions')
        .where({ course, question_id: req.params.questionId })
        .first();
      if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });
      res.json({ data: question });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
