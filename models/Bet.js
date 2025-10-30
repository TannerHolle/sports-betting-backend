const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  gameId: { type: String, required: true },
  betType: { type: String, enum: ['moneyline', 'spread', 'total'], required: true },
  selection: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  odds: { type: String, required: true },
  line: { type: String, default: null },
  potentialWin: { type: Number, required: true, min: 0 },
  sport: { type: String, default: null },
  status: { type: String, enum: ['pending', 'won', 'lost'], default: 'pending' },
  gameData: { type: mongoose.Schema.Types.Mixed, default: null },
  actualResult: { type: mongoose.Schema.Types.Mixed, default: null },
  resolvedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Bet', betSchema);


