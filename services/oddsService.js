const axios = require('axios');

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const ODDS_API_BASE_URL = 'https://api.the-odds-api.com/v4';

const SPORTS_MAPPING = {
  'nba': 'basketball_nba',
  'ncaa-basketball': 'basketball_ncaab',
  'ncaa-football': 'americanfootball_ncaaf',
  'nfl': 'americanfootball_nfl'
};

class OddsService {
  constructor() {
    this.lastFetchDate = null;
    this.cachedOdds = {};
  }

  needsUpdate() {
    const today = new Date().toDateString();
    return this.lastFetchDate !== today;
  }

  async fetchOdds(sport) {
    try {
      const sportKey = SPORTS_MAPPING[sport];
      if (!sportKey) throw new Error(`Unsupported sport: ${sport}`);
      console.log(`[ODDS] Making API call for ${sport} (${sportKey})`);
      const response = await axios.get(`${ODDS_API_BASE_URL}/sports/${sportKey}/odds`, {
        params: { apiKey: ODDS_API_KEY, regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'american', dateFormat: 'iso' }
      });
      console.log(`[ODDS] Successfully fetched ${sport} - ${response.data?.length || 0} games`);
      return response.data;
    } catch (error) {
      console.error(`[ODDS] Error fetching odds for ${sport}:`, error.message);
      return this.generateMockOdds(sport);
    }
  }

  generateMockOdds(sport) {
    return [];
  }

  async fetchAllOdds() {
    const sports = Object.keys(SPORTS_MAPPING);
    const allOdds = {};
    console.log(`[ODDS] Fetching odds for ${sports.length} sports: ${sports.join(', ')}`);
    for (const sport of sports) {
      try { allOdds[sport] = await this.fetchOdds(sport); } catch { allOdds[sport] = []; }
    }
    this.lastFetchDate = new Date().toDateString();
    this.cachedOdds = allOdds;
    console.log(`[ODDS] Completed fetching all odds. Total API calls made: ${sports.length}`);
    return allOdds;
  }

  getCachedOdds(sport) { return this.cachedOdds[sport] || []; }
  getAllCachedOdds() { return this.cachedOdds; }

  processOddsData(oddsData, sport) {
    if (!Array.isArray(oddsData)) return [];
    return oddsData.map(game => {
      const bookmaker = Array.isArray(game.bookmakers) && game.bookmakers[0];
      const odds = this.extractOddsFromBookmakers(bookmaker ? game.bookmakers : []);
      return { id: game.id, sport, homeTeam: game.home_team, awayTeam: game.away_team, commenceTime: game.commence_time, odds, lastUpdated: new Date().toISOString() };
    });
  }

  extractOddsFromBookmakers(bookmakers) {
    if (!Array.isArray(bookmakers) || bookmakers.length === 0) return {};
    const bookmaker = bookmakers[0];
    const odds = {};
    bookmaker.markets.forEach(market => {
      if (market.key === 'h2h') {
        market.outcomes.forEach(o => { odds[`${o.name}_moneyline`] = o.price; });
      } else if (market.key === 'spreads') {
        market.outcomes.forEach(o => { odds[`${o.name}_spread`] = { line: o.point, price: o.price }; });
      } else if (market.key === 'totals') {
        market.outcomes.forEach(o => { odds[`${o.name}_total`] = { line: o.point, price: o.price }; });
      }
    });
    return odds;
  }
}

module.exports = new OddsService();


