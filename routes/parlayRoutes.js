const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Parlay = require('../models/Parlay');
const { combineLegs, decimalToAmerican, formatAmerican, calculatePayout, americanToDecimal } = require('../utils/oddsMath');

const MIN_LEGS = 2;
const MAX_LEGS = 10;

// Totals arrive as "o47.5"/"u47.5"; spreads must keep their sign.
const normalizeLine = (line, betType) => {
  if (line === undefined || line === null) return null;
  const raw = String(line).trim();
  if (betType === 'spread') return Number.isNaN(parseFloat(raw)) ? null : raw;
  return raw.replace(/^[ouOU]/i, '');
};

const startTimeOf = (leg) => {
  const t = leg?.gameData?.gameStartTime;
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Place a parlay
router.post('/user/:username/parlay', async (req, res) => {
  try {
    const { username } = req.params;
    const { legs, amount } = req.body || {};

    const user = await User.findOne({ username: String(username).toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!Array.isArray(legs) || legs.length < MIN_LEGS) {
      return res.status(400).json({ error: `A parlay needs at least ${MIN_LEGS} legs` });
    }
    if (legs.length > MAX_LEGS) {
      return res.status(400).json({ error: `A parlay can have at most ${MAX_LEGS} legs` });
    }

    const stake = Number(amount);
    if (!Number.isFinite(stake) || stake <= 0) {
      return res.status(400).json({ error: 'Bet amount must be a positive number' });
    }
    if (user.balance < stake) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Same-game parlays are fine - you can mix spread, moneyline and total on
    // one game. What's blocked is two picks from the SAME market on the same
    // game, because those are opposite sides of one line (Over and Under, both
    // moneylines, both sides of a spread) and can never both win.
    const gameIds = legs.map(l => l && l.gameId);
    if (gameIds.some(id => !id)) {
      return res.status(400).json({ error: 'Every leg needs a gameId' });
    }
    const markets = legs.map(l => `${l.gameId}:${l.betType}`);
    if (new Set(markets).size !== markets.length) {
      return res.status(400).json({
        error: 'You already have a pick from that market on this game - try a different bet type'
      });
    }

    const now = new Date();
    const cleanLegs = [];
    for (const leg of legs) {
      if (!leg.betType || !leg.selection || leg.odds === undefined || leg.odds === null) {
        return res.status(400).json({ error: 'Each leg needs betType, selection and odds' });
      }
      if (americanToDecimal(leg.odds) === null) {
        return res.status(400).json({ error: `Could not read the odds on ${leg.selection}` });
      }
      const startsAt = startTimeOf(leg);
      if (startsAt && startsAt <= now) {
        return res.status(400).json({ error: `${leg.selection} has already started` });
      }
      cleanLegs.push({
        gameId: String(leg.gameId),
        betType: leg.betType,
        selection: String(leg.selection),
        odds: String(leg.odds),
        line: normalizeLine(leg.line, leg.betType),
        sport: leg.sport || null,
        gameData: leg.gameData || null,
        status: 'pending'
      });
    }

    // Price it here rather than trusting whatever the client computed
    const decimal = combineLegs(cleanLegs);
    if (decimal === null) return res.status(400).json({ error: 'Could not price this parlay' });
    const potentialWin = calculatePayout(cleanLegs, stake);
    const combinedOdds = formatAmerican(decimalToAmerican(decimal));

    const parlay = new Parlay({
      user: user._id,
      legs: cleanLegs,
      amount: stake,
      odds: combinedOdds,
      potentialWin,
      status: 'pending'
    });
    await parlay.save();

    await User.updateOne(
      { _id: user._id },
      { $inc: { balance: -stake, totalWagered: stake }, $push: { parlays: parlay._id } }
    );

    const updated = await User.findById(user._id).populate('bets').populate('parlays');
    const safe = updated.toObject();
    delete safe.password;
    res.status(201).json({ success: true, parlay, user: safe });
  } catch (error) {
    console.error('Error placing parlay:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map(e => e.message).join(', ') });
    }
    res.status(500).json({ error: 'Failed to place parlay' });
  }
});

// Cancel a parlay - only while every leg is still unstarted
router.delete('/user/:username/parlay/:parlayId', async (req, res) => {
  try {
    const { username, parlayId } = req.params;
    const user = await User.findOne({ username: String(username).toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const parlay = await Parlay.findOne({ _id: parlayId, user: user._id });
    if (!parlay) return res.status(404).json({ error: 'Parlay not found' });
    if (parlay.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending parlays can be cancelled' });
    }

    const now = new Date();
    const started = parlay.legs.find(leg => {
      const t = startTimeOf(leg);
      return t && t <= now;
    });
    if (started) {
      return res.status(400).json({ error: `${started.selection} has already started - this parlay can no longer be cancelled` });
    }

    await User.updateOne(
      { _id: user._id },
      { $inc: { balance: parlay.amount, totalWagered: -parlay.amount }, $pull: { parlays: parlay._id } }
    );
    await Parlay.deleteOne({ _id: parlay._id });

    const updated = await User.findById(user._id).populate('bets').populate('parlays');
    const safe = updated.toObject();
    delete safe.password;
    res.json({ success: true, user: safe });
  } catch (error) {
    console.error('Error cancelling parlay:', error);
    res.status(500).json({ error: 'Failed to cancel parlay' });
  }
});

// Preview pricing without placing anything (used by the bet slip)
router.post('/parlay/quote', async (req, res) => {
  try {
    const { legs, amount } = req.body || {};
    if (!Array.isArray(legs) || legs.length < MIN_LEGS) {
      return res.status(400).json({ error: `A parlay needs at least ${MIN_LEGS} legs` });
    }
    const decimal = combineLegs(legs);
    if (decimal === null) return res.status(400).json({ error: 'Could not price this parlay' });
    const stake = Number(amount) > 0 ? Number(amount) : 0;
    res.json({
      odds: formatAmerican(decimalToAmerican(decimal)),
      decimal: Number(decimal.toFixed(4)),
      potentialWin: stake ? calculatePayout(legs, stake) : 0,
      legs: legs.length
    });
  } catch (error) {
    console.error('Error quoting parlay:', error);
    res.status(500).json({ error: 'Failed to quote parlay' });
  }
});

module.exports = router;
