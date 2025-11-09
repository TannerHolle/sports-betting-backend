const OpenAI = require('openai');

// Lazy initialization of OpenAI client
let openai = null;

function getOpenAIClient() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key is missing. Please set OPENAI_API_KEY in your .env file.');
    }
    openai = new OpenAI({
      apiKey: apiKey
    });
  }
  return openai;
}

/**
 * Format game context for AI prompt
 * @param {Object} gameContext - Game data with teams, odds, etc.
 * @returns {string} - Formatted context string
 */
function formatGameContext(gameContext) {
  if (!gameContext) return '';

  let context = `\n\n=== CURRENT GAME CONTEXT ===\n`;
  context += `Teams: ${gameContext.awayTeam} @ ${gameContext.homeTeam}\n`;
  context += `Sport: ${gameContext.sport.toUpperCase()}\n`;
  
  if (gameContext.commenceTime) {
    const gameDate = new Date(gameContext.commenceTime);
    context += `Game Time: ${gameDate.toLocaleString()}\n`;
  }

  // Add team information if available (for NFL, NBA, NCAA Basketball, NCAA Football)
  if (gameContext.homeTeamInfo || gameContext.awayTeamInfo) {
    context += `\n--- Team Information ---\n`;
    
    if (gameContext.awayTeamInfo) {
      context += `${gameContext.awayTeam}:`;
      if (gameContext.awayTeamInfo.record) {
        context += ` ${gameContext.awayTeamInfo.record}`;
      }
      if (gameContext.awayTeamInfo.winPercent !== null) {
        context += ` (${gameContext.awayTeamInfo.winPercent}% win rate)`;
      }
      if (gameContext.awayTeamInfo.awayRecord) {
        context += ` | Away: ${gameContext.awayTeamInfo.awayRecord}`;
      }
      if (gameContext.awayTeamInfo.streak !== null) {
        const streakText = gameContext.awayTeamInfo.streak > 0 
          ? `${gameContext.awayTeamInfo.streak}W` 
          : `${Math.abs(gameContext.awayTeamInfo.streak)}L`;
        context += ` | Streak: ${streakText}`;
      }
      if (gameContext.awayTeamInfo.avgPointsFor !== null) {
        context += ` | ${gameContext.awayTeamInfo.avgPointsFor} PPG`;
        if (gameContext.awayTeamInfo.avgPointsAgainst !== null) {
          context += ` / ${gameContext.awayTeamInfo.avgPointsAgainst} PAG`;
        }
      }
      if (gameContext.awayTeamInfo.standing) {
        context += ` | ${gameContext.awayTeamInfo.standing}`;
      }
      context += `\n`;
    }
    
    if (gameContext.homeTeamInfo) {
      context += `${gameContext.homeTeam}:`;
      if (gameContext.homeTeamInfo.record) {
        context += ` ${gameContext.homeTeamInfo.record}`;
      }
      if (gameContext.homeTeamInfo.winPercent !== null) {
        context += ` (${gameContext.homeTeamInfo.winPercent}% win rate)`;
      }
      if (gameContext.homeTeamInfo.homeRecord) {
        context += ` | Home: ${gameContext.homeTeamInfo.homeRecord}`;
      }
      if (gameContext.homeTeamInfo.streak !== null) {
        const streakText = gameContext.homeTeamInfo.streak > 0 
          ? `${gameContext.homeTeamInfo.streak}W` 
          : `${Math.abs(gameContext.homeTeamInfo.streak)}L`;
        context += ` | Streak: ${streakText}`;
      }
      if (gameContext.homeTeamInfo.avgPointsFor !== null) {
        context += ` | ${gameContext.homeTeamInfo.avgPointsFor} PPG`;
        if (gameContext.homeTeamInfo.avgPointsAgainst !== null) {
          context += ` / ${gameContext.homeTeamInfo.avgPointsAgainst} PAG`;
        }
      }
      if (gameContext.homeTeamInfo.standing) {
        context += ` | ${gameContext.homeTeamInfo.standing}`;
      }
      context += `\n`;
    }
  }

  if (gameContext.odds) {
    context += `\n--- Betting Odds ---\n`;
    
    // Moneyline
    if (gameContext.odds.homeMoneyline || gameContext.odds.awayMoneyline) {
      context += `Moneyline:\n`;
      if (gameContext.odds.homeMoneyline) {
        context += `  ${gameContext.homeTeam}: ${gameContext.odds.homeMoneyline > 0 ? '+' : ''}${gameContext.odds.homeMoneyline}\n`;
      }
      if (gameContext.odds.awayMoneyline) {
        context += `  ${gameContext.awayTeam}: ${gameContext.odds.awayMoneyline > 0 ? '+' : ''}${gameContext.odds.awayMoneyline}\n`;
      }
    }

    // Point Spread
    if (gameContext.odds.homeSpread || gameContext.odds.awaySpread) {
      context += `Point Spread:\n`;
      if (gameContext.odds.homeSpread) {
        const spread = gameContext.odds.homeSpread;
        context += `  ${gameContext.homeTeam}: ${spread.line > 0 ? '+' : ''}${spread.line} (${spread.price > 0 ? '+' : ''}${spread.price})\n`;
      }
      if (gameContext.odds.awaySpread) {
        const spread = gameContext.odds.awaySpread;
        context += `  ${gameContext.awayTeam}: ${spread.line > 0 ? '+' : ''}${spread.line} (${spread.price > 0 ? '+' : ''}${spread.price})\n`;
      }
    }

    // Totals
    if (gameContext.odds.overTotal || gameContext.odds.underTotal) {
      context += `Total (Over/Under):\n`;
      if (gameContext.odds.overTotal) {
        const total = gameContext.odds.overTotal;
        context += `  Over ${total.line}: ${total.price > 0 ? '+' : ''}${total.price}\n`;
      }
      if (gameContext.odds.underTotal) {
        const total = gameContext.odds.underTotal;
        context += `  Under ${total.line}: ${total.price > 0 ? '+' : ''}${total.price}\n`;
      }
    }
  }

  if (gameContext.venue) {
    context += `\nVenue: ${gameContext.venue}\n`;
  }

  if (gameContext.status) {
    context += `Status: ${gameContext.status}\n`;
  }

  context += `\nYou can now answer questions about this specific game, including betting recommendations, odds analysis, and game insights.`;

  return context;
}

/**
 * Get AI response for betting-related questions
 * @param {string} question - User's question about betting
 * @param {Object} gameContext - Optional game context with teams, odds, etc.
 * @returns {Promise<string>} - AI response
 */
async function getBettingAnswer(question, gameContext = null) {
  try {
    const client = getOpenAIClient();
    let systemPrompt = `You are a sports betting assistant. Provide brief, clear answers about sports betting and team information.

CRITICAL: Be direct and concise.

Guidelines:
- Provide examples when helpful
- Discuss these types of bets: point spread, moneyline, totals (over/under). No other types of bets.
- The odds are always in american format
- Help users understand betting strategies and how to read odds
- You can also provide team information, statistics, and analysis when relevant to betting decisions
- Use team records, home/away performance, scoring averages, and streaks to inform betting recommendations`;

    // Add game context if provided
    if (gameContext) {
      systemPrompt += formatGameContext(gameContext);
      systemPrompt += `\n\nWhen answering questions about this game, use the actual odds, team statistics, and information provided above. You can discuss team performance, records, trends, and how they relate to the betting lines.`;
    } else {
      systemPrompt += `\n- If asked about specific games or odds, explain that you don't have real-time data but can explain how to interpret odds`;
    }

    systemPrompt += `\n- Keep responses informative but not overly long
- Use a friendly, approachable tone
- If the question is not related to sports, say that you are a sports betting assistant and ask the user to ask a question about sports betting or team analysis.`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    
    // Handle missing API key error
    if (error.message && error.message.includes('API key') && error.message.includes('missing')) {
      throw new Error('OpenAI API key is missing. Please set OPENAI_API_KEY in your .env file and restart the server.');
    }
    
    // Handle specific error cases
    const statusCode = error.status || error.statusCode || (error.response && error.response.status);
    
    if (statusCode === 401) {
      throw new Error('OpenAI API key is invalid. Please check your .env file.');
    } else if (statusCode === 429) {
      throw new Error('Rate limit exceeded. Please try again later.');
    } else if (statusCode === 500 || statusCode === 503) {
      throw new Error('OpenAI service is temporarily unavailable. Please try again later.');
    } else if (error.message && error.message.includes('API key')) {
      throw new Error('OpenAI API key is invalid or missing. Please check your .env file.');
    } else {
      throw new Error(error.message || 'Failed to get AI response. Please try again.');
    }
  }
}

module.exports = {
  getBettingAnswer,
  formatGameContext
};

