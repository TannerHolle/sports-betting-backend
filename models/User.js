const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phoneNumber: { type: String, required: true, trim: true },
  balance: { type: Number, default: 1000, min: 0 },
  totalWagered: { type: Number, default: 0, min: 0 },
  totalWon: { type: Number, default: 0, min: 0 },
  totalLost: { type: Number, default: 0, min: 0 },
  bets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bet' }],
  parlays: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Parlay' }],
  leagues: [{ type: mongoose.Schema.Types.ObjectId, ref: 'League' }]
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);


