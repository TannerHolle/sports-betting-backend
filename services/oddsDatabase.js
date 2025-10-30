const fs = require('fs').promises;
const path = require('path');

const ODDS_FILE = path.join(__dirname, '..', 'data', 'odds.json');

class OddsDatabase {
  constructor() { this.ensureDataDir(); }
  async ensureDataDir() {
    const dataDir = path.dirname(ODDS_FILE);
    try { await fs.access(dataDir); } catch { await fs.mkdir(dataDir, { recursive: true }); }
  }
  async loadOdds() {
    try { await fs.access(ODDS_FILE); const data = await fs.readFile(ODDS_FILE, 'utf8'); return JSON.parse(data); }
    catch { return { lastUpdated: null, odds: { nba: [], 'ncaa-basketball': [], 'ncaa-football': [] } }; }
  }
  async saveOdds(oddsData) { await this.ensureDataDir(); await fs.writeFile(ODDS_FILE, JSON.stringify(oddsData, null, 2)); }
  async updateOdds(newOdds) { const oddsData = { lastUpdated: new Date().toISOString(), odds: newOdds }; await this.saveOdds(oddsData); return oddsData; }
  async getOddsForSport(sport) { const oddsData = await this.loadOdds(); return oddsData.odds[sport] || []; }
  async getAllOdds() { const oddsData = await this.loadOdds(); return oddsData.odds; }
  async getLastUpdateTime() { const oddsData = await this.loadOdds(); return oddsData.lastUpdated; }
  async needsUpdate() { const last = await this.getLastUpdateTime(); if (!last) return true; return new Date(last).toDateString() !== new Date().toDateString(); }
}

module.exports = new OddsDatabase();


