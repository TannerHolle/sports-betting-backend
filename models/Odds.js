const mongoose = require('mongoose');

const oddsSchema = new mongoose.Schema({
  sport: { 
    type: String, 
    required: true, 
    enum: ['nba', 'ncaa-basketball', 'ncaa-football', 'nfl'],
    unique: true 
  },
  games: [{
    id: { type: String, required: true },
    homeTeam: { type: String, required: true },
    awayTeam: { type: String, required: true },
    commenceTime: { type: Date, required: true },
    odds: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastUpdated: { type: Date, default: Date.now }
  }],
  lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

// Index for faster queries
oddsSchema.index({ sport: 1, lastUpdated: -1 });

module.exports = mongoose.model('Odds', oddsSchema);

