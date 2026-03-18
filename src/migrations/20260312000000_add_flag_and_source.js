/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('questions', (table) => {
    table.boolean('is_flagged').defaultTo(false);
    table.text('source_file');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('questions', (table) => {
    table.dropColumn('is_flagged');
    table.dropColumn('source_file');
  });
};
