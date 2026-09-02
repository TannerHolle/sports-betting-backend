const express = require('express');
const router = express.Router();
const User = require('../models/User');
const League = require('../models/League');

// Leaderboard rows, computed in the database.
//
// This used to be done by fetching /api/users (which populates every bet of
// every user) and reducing it in the browser - hundreds of KB transferred to
// produce a couple of dozen numbers. The payload here is a few KB and grows
// with the number of players, not the number of bets.
router.get('/', async (req, res) => {
  try {
    const { leagueId } = req.query;

    const match = {};
    if (leagueId) {
      const league = await League.findById(leagueId);
      if (!league) return res.status(404).json({ error: 'League not found' });
      match._id = { $in: league.members };
    }

    const rows = await User.aggregate([
      { $match: match },
      { $lookup: { from: 'bets', localField: '_id', foreignField: 'user', as: 'straightBets' } },
      { $lookup: { from: 'parlays', localField: '_id', foreignField: 'user', as: 'parlayBets' } },
      // A parlay counts exactly like a straight bet here. netProfit comes from
      // the user's running totals, which parlay resolution already updates, so
      // leaving parlays out of these counts would drop a parlay-only player off
      // the board entirely via the completedBets filter below.
      {
        $addFields: {
          userBets: { $concatArrays: ['$straightBets', '$parlayBets'] }
        }
      },
      {
        $addFields: {
          totalBets: { $size: '$userBets' },
          completedBets: {
            $size: {
              $filter: { input: '$userBets', as: 'b', cond: { $in: ['$$b.status', ['won', 'lost']] } }
            }
          },
          wonBets: {
            $size: {
              $filter: { input: '$userBets', as: 'b', cond: { $eq: ['$$b.status', 'won'] } }
            }
          },
          outstandingAmount: {
            $sum: {
              $map: {
                input: {
                  $filter: { input: '$userBets', as: 'b', cond: { $eq: ['$$b.status', 'pending'] } }
                },
                as: 'p',
                in: { $ifNull: ['$$p.amount', 0] }
              }
            }
          }
        }
      },
      // Same rule the UI applied: only rank players who have settled a bet
      { $match: { completedBets: { $gt: 0 } } },
      {
        $addFields: {
          netProfit: { $subtract: [{ $ifNull: ['$totalWon', 0] }, { $ifNull: ['$totalLost', 0] }] },
          totalCash: { $add: [{ $ifNull: ['$balance', 0] }, '$outstandingAmount'] },
          winRate: {
            $round: [{ $multiply: [{ $divide: ['$wonBets', '$completedBets'] }, 100] }, 0]
          }
        }
      },
      { $sort: { netProfit: -1, username: 1 } },
      {
        $project: {
          _id: 0,
          username: 1,
          balance: { $ifNull: ['$balance', 0] },
          totalWon: { $ifNull: ['$totalWon', 0] },
          totalLost: { $ifNull: ['$totalLost', 0] },
          outstandingAmount: 1,
          totalCash: 1,
          netProfit: 1,
          winRate: 1,
          totalBets: 1,
          completedBets: 1
        }
      }
    ]);

    res.json(rows);
  } catch (error) {
    console.error('Error building leaderboard:', error);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

module.exports = router;
