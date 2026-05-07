const express = require('express');
const { runImportJob } = require('../services/questionImportService');

const router = express.Router();

module.exports = (db) => {
  router.post('/import-questions', async (req, res) => {
    try {
      const { prune = false, dryRun = false, force = false } = req.body || {};
      const summary = await runImportJob(db, {
        prune: !!prune,
        dryRun: !!dryRun,
        force: !!force,
        triggeredBy: 'single_user_ui',
      });
      res.json({ data: summary });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
