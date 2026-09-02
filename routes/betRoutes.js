const express = require('express');
const router = express.Router();
const betResolver = require('../services/betResolver');

// Force resolve all pending bets
router.post('/force-resolve', async (req, res) => {
  try {
    await betResolver.resolveAll();
    res.json({ success: true, message: 'Bets resolved successfully' });
  } catch (error) {
    console.error('Error force resolving bets:', error);
    res.status(500).json({ error: 'Failed to resolve bets', details: error.message });
  }
});

module.exports = router;

