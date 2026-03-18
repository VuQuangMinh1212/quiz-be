/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // Bảng câu hỏi - import từ JSON
  await knex.schema.createTable('questions', (table) => {
    table.increments('id').primary();
    table.integer('question_id').unique().notNullable();  // questionId từ JSON
    table.text('question_text').notNullable();
    table.text('explanation');
    table.jsonb('answers').notNullable();         // array đáp án
    table.jsonb('correct_answer').notNullable();  // array đáp án đúng
    table.timestamps(true, true);
  });

  // Bảng lịch sử làm bài
  await knex.schema.createTable('attempts', (table) => {
    table.increments('id').primary();
    table.integer('question_id').notNullable()
      .references('question_id').inTable('questions').onDelete('CASCADE');
    table.jsonb('selected_answers').notNullable();  // array đáp án user chọn
    table.boolean('is_correct').notNullable();
    table.integer('attempt_number').notNullable();  // 0 = lần thi gốc từ JSON
    table.boolean('is_flagged').defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Index để query nhanh
  await knex.schema.raw(
    'CREATE INDEX idx_attempts_question_id ON attempts(question_id)'
  );
  await knex.schema.raw(
    'CREATE INDEX idx_attempts_is_correct ON attempts(is_correct)'
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('attempts');
  await knex.schema.dropTableIfExists('questions');
};
