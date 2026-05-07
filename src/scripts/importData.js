require('dotenv').config();
const knex = require('knex');
const knexConfig = require('../../knexfile');
const { runImportJob } = require('../services/questionImportService');

const db = knex(knexConfig[process.env.NODE_ENV || 'development']);

async function main() {
  const summary = await runImportJob(db, {
    prune: process.argv.includes('--prune'),
    dryRun: process.argv.includes('--dry-run'),
    force: process.argv.includes('--force'),
    triggeredBy: 'cli',
  });
  console.log('✅ Import hoàn tất');
  console.log(JSON.stringify(summary, null, 2));
  await db.destroy();
}

main().catch((err) => {
  console.error('❌ Import thất bại:', err);
  process.exit(1);
});
