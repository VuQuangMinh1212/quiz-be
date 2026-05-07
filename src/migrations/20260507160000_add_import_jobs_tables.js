/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('import_jobs', (table) => {
    table.increments('id').primary();
    table.text('triggered_by').notNullable().defaultTo('manual');
    table.boolean('prune').notNullable().defaultTo(false);
    table.boolean('dry_run').notNullable().defaultTo(false);
    table.boolean('force').notNullable().defaultTo(false);
    table.text('status').notNullable().defaultTo('running');
    table.integer('files_total').notNullable().defaultTo(0);
    table.integer('files_processed').notNullable().defaultTo(0);
    table.integer('files_failed').notNullable().defaultTo(0);
    table.integer('inserted').notNullable().defaultTo(0);
    table.integer('updated').notNullable().defaultTo(0);
    table.integer('deleted').notNullable().defaultTo(0);
    table.integer('skipped').notNullable().defaultTo(0);
    table.integer('seed_skipped').notNullable().defaultTo(0);
    table.text('error_message');
    table.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('finished_at');
  });

  await knex.schema.createTable('import_job_items', (table) => {
    table.increments('id').primary();
    table.integer('job_id').notNullable()
      .references('id')
      .inTable('import_jobs')
      .onDelete('CASCADE');
    table.text('course').notNullable();
    table.text('source_file').notNullable();
    table.text('status').notNullable();
    table.text('checksum_old');
    table.text('checksum_new');
    table.integer('inserted').notNullable().defaultTo(0);
    table.integer('updated').notNullable().defaultTo(0);
    table.integer('deleted').notNullable().defaultTo(0);
    table.integer('skipped').notNullable().defaultTo(0);
    table.integer('seed_skipped').notNullable().defaultTo(0);
    table.integer('total_items').notNullable().defaultTo(0);
    table.text('error_message');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    'CREATE INDEX idx_import_job_items_job_id ON import_job_items(job_id)',
  );
  await knex.schema.raw(
    'CREATE INDEX idx_import_job_items_course_source ON import_job_items(course, source_file, id DESC)',
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('import_job_items');
  await knex.schema.dropTableIfExists('import_jobs');
};
