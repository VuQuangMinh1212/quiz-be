/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('questions', (table) => {
    table.text('course').defaultTo('dva');
  });

  await knex('questions').whereNull('course').update({ course: 'dva' });
  await knex.schema.raw('ALTER TABLE questions ALTER COLUMN course SET NOT NULL');

  await knex.schema.alterTable('attempts', (table) => {
    table.text('course').defaultTo('dva');
  });

  await knex.raw(`
    UPDATE attempts a
    SET course = q.course
    FROM questions q
    WHERE a.question_id = q.question_id
      AND (a.course IS NULL OR a.course = '')
  `);

  await knex('attempts').whereNull('course').update({ course: 'dva' });
  await knex.schema.raw('ALTER TABLE attempts ALTER COLUMN course SET NOT NULL');

  await knex.schema.raw('ALTER TABLE attempts DROP CONSTRAINT IF EXISTS attempts_question_id_foreign');
  await knex.schema.raw('ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_question_id_unique');

  await knex.schema.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_course_question_id_unique ON questions(course, question_id)');
  await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_questions_course ON questions(course)');
  await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_attempts_course_question_id ON attempts(course, question_id)');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS idx_attempts_course_question_id');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_questions_course');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_questions_course_question_id_unique');

  await knex.schema.raw('ALTER TABLE questions ADD CONSTRAINT questions_question_id_unique UNIQUE (question_id)');
  await knex.schema.raw('ALTER TABLE attempts ADD CONSTRAINT attempts_question_id_foreign FOREIGN KEY (question_id) REFERENCES questions(question_id) ON DELETE CASCADE');

  await knex.schema.alterTable('attempts', (table) => {
    table.dropColumn('course');
  });

  await knex.schema.alterTable('questions', (table) => {
    table.dropColumn('course');
  });
};
