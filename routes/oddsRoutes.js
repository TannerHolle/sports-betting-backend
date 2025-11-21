const express = require('express');
const router = express.Router();
const oddsDatabase = require('../services/oddsDatabase');
const { checkAndUpdateOdds } = require('../middleware/oddsMiddleware');

// IMPORTANT: Specific routes must come BEFORE parameterized routes like /:sport

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

// Force update odds (bypasses daily limit - use with caution)
router.post('/force-update', async (req, res) => {
  try {
    console.log('[ODDS] Force update requested - bypassing daily limit check');
    const oddsService = require('../services/oddsService');
    const freshOdds = await oddsService.fetchAllOdds();
    const processedOdds = {};
    for (const [sport, oddsData] of Object.entries(freshOdds)) {
      processedOdds[sport] = oddsService.processOddsData(oddsData, sport);
    }
    const updated = await oddsDatabase.updateOdds(processedOdds);
    console.log('[ODDS] Force update completed successfully');
    
    // Historical odds are already saved by updateOdds
    res.json({ success: true, message: 'Odds updated successfully' });
  } catch (error) {
    console.error('[ODDS] Error force updating odds:', error);
    res.status(500).json({ error: 'Failed to force update odds', details: error.message });
  }
});

// Save current odds to historical collection (without running full outcomes processing)
router.post('/save-historical', async (req, res) => {
  try {
    console.log('[ODDS] Saving current odds to historical collection...');
    const oddsService = require('../services/oddsService');
    const freshOdds = await oddsService.fetchAllOdds();
    const processedOdds = {};
    for (const [sport, oddsData] of Object.entries(freshOdds)) {
      processedOdds[sport] = oddsService.processOddsData(oddsData, sport);
    }
    const archived = await oddsDatabase.saveHistoricalOdds(processedOdds);
    console.log('[ODDS] Historical odds saved successfully');
    res.json({ success: true, message: `Saved ${archived} games to historical odds` });
  } catch (error) {
    console.error('[ODDS] Error saving historical odds:', error);
    res.status(500).json({ error: 'Failed to save historical odds', details: error.message });
  }
});

// Get odds for specific sport (must come LAST - parameterized route)
router.get('/:sport', checkAndUpdateOdds, async (req, res) => {
  try {
    const { sport } = req.params;
    const validSports = ['nba', 'ncaa-basketball', 'ncaa-football', 'nfl'];
    if (!validSports.includes(sport)) {
      return res.status(400).json({ error: 'Invalid sport. Supported sports: nba, ncaa-basketball, ncaa-football, nfl' });
    }
    const odds = await oddsDatabase.getOddsForSport(sport);
    res.json(odds);
  } catch (error) {
    console.error('Error fetching odds:', error);
    res.status(500).json({ error: 'Failed to load odds' });
  }
});

module.exports = router;

