const express = require('express');
const router = express.Router();
const { getBettingAnswer } = require('../services/aiService');
const AIQuestion = require('../models/AIQuestion');
const User = require('../models/User');

/**
 * POST /api/ai/ask
 * Ask a question about betting
 * Body: { question: string, gameContext?: object }
 */
router.post('/ask', async (req, res) => {
  try {
    const { question, gameContext, username } = req.body;

    // Validate input
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Question is required and must be a non-empty string' 
      });
    }

    // Limit question length
    if (question.length > 1000) {
      return res.status(400).json({ 
        error: 'Question is too long. Maximum 1000 characters.' 
      });
    }

    // Validate gameContext if provided
    if (gameContext && typeof gameContext !== 'object') {
      return res.status(400).json({ 
        error: 'Game context must be an object' 
      });
    }

    // Get AI response with game context if provided
    const answer = await getBettingAnswer(question.trim(), gameContext || null);

    // Save the question for analysis (don't block the response if this fails)
    try {
      const questionData = {
        question: question.trim(),
        answer: answer || null
      };

      // Extract key game context info for easy querying
      if (gameContext) {
        questionData.gameContext = {
          sport: gameContext.sport || null,
          homeTeam: gameContext.homeTeam || null,
          awayTeam: gameContext.awayTeam || null,
          gameId: gameContext.id || gameContext.gameId || null
        };
      }

      // Save user info if username is provided
      if (username) {
        const user = await User.findOne({ username: username.toLowerCase() });
        if (user) {
          questionData.user = user._id;
          questionData.username = user.username;
        }
      }

      await AIQuestion.create(questionData);
    } catch (saveError) {
      // Log but don't fail the request if saving fails
      console.error('Error saving AI question:', saveError);
    }

    res.json({
      success: true,
      question: question.trim(),
      answer
    });
  } catch (error) {
    console.error('Error in AI route:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process question. Please try again.' 
    });
  }
});

/**
 * GET /api/ai/questions
 * Get all saved AI questions for analysis
 * Query params: limit (default: 100), skip (default: 0), sport (filter by sport), username (filter by username)
 */
router.get('/questions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const skip = parseInt(req.query.skip) || 0;
    const sport = req.query.sport;
    const username = req.query.username;

    // Build query
    const query = {};
    if (sport) {
      query['gameContext.sport'] = sport;
    }
    if (username) {
      query.username = username.toLowerCase();
    }

    // Get questions with pagination
    const questions = await AIQuestion.find(query)
      .populate('user', 'username') // Populate user info if available
      .sort({ createdAt: -1 }) // Most recent first
      .limit(limit)
      .skip(skip)
      .select('-__v') // Exclude version key
      .lean(); // Return plain objects for better performance

    // Get total count for pagination info
    const total = await AIQuestion.countDocuments(query);

    res.json({
      success: true,
      questions,
      pagination: {
        total,
        limit,
        skip,
        hasMore: skip + questions.length < total
      }
    });
  } catch (error) {
    console.error('Error fetching AI questions:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch questions' 
    });
  }
});

/**
 * DELETE /api/ai/questions
 * Delete all AI questions
 */
router.delete('/questions', async (req, res) => {
  try {
    const result = await AIQuestion.deleteMany({});
    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} AI questions`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error deleting AI questions:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to delete AI questions' 
    });
  }
});

module.exports = router;

