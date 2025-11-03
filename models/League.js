const mongoose = require('mongoose');

const leagueSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  inviteCode: { type: String, unique: true, sparse: true, uppercase: true } // Short shareable code
}, { timestamps: true });

module.exports = mongoose.model('League', leagueSchema);
