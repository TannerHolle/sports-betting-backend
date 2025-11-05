const express = require('express');
const router = express.Router();
const oddsDatabase = require('../services/oddsDatabase');
const { checkAndUpdateOdds } = require('../middleware/oddsMiddleware');

// Get odds for specific sport
router.get('/:sport', checkAndUpdateOdds, async (req, res) => {
  try {
    const { sport } = req.params;
    const validSports = ['nba', 'ncaa-basketball', 'ncaa-football'];
    if (!validSports.includes(sport)) {
      return res.status(400).json({ error: 'Invalid sport. Supported sports: nba, ncaa-basketball, ncaa-football' });
    }
    const odds = await oddsDatabase.getOddsForSport(sport);
    res.json(odds);
  } catch (error) {
    console.error('Error fetching odds:', error);
    res.status(500).json({ error: 'Failed to load odds' });
  }
});

// Get all odds
router.get('/', checkAndUpdateOdds, async (req, res) => {
  try {
    const allOdds = await oddsDatabase.getAllOdds();
    res.json(allOdds);
  } catch (error) {
    console.error('Error fetching all odds:', error);
    res.status(500).json({ error: 'Failed to load odds' });
  }
});

// Get last update time
router.get('/last-update', async (req, res) => {
  try {
    const lastUpdate = await oddsDatabase.getLastUpdateTime();
    res.json({ lastUpdated: lastUpdate });
  } catch (error) {
    console.error('Error fetching last update time:', error);
    res.status(500).json({ error: 'Failed to get last update time' });
  }
});

// Force update odds
router.post('/force-update', async (req, res) => {
  try {
    const oddsService = require('../services/oddsService');
    const freshOdds = await oddsService.fetchAllOdds();
    const processedOdds = {};
    for (const [sport, oddsData] of Object.entries(freshOdds)) {
      processedOdds[sport] = oddsService.processOddsData(oddsData, sport);
    }
    await oddsDatabase.updateOdds(processedOdds);
    res.json({ success: true, message: 'Odds updated successfully' });
  } catch (error) {
    console.error('Error force updating odds:', error);
    res.status(500).json({ error: 'Failed to force update odds', details: error.message });
  }
});

module.exports = router;

