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
 * Get AI response for betting-related questions
 * @param {string} question - User's question about betting
 * @returns {Promise<string>} - AI response
 */
async function getBettingAnswer(question) {
  try {
    const client = getOpenAIClient();
    const systemPrompt = `You are a sports betting assistant for a fantasy sports betting platform. Your role is to provide accurate and educational information about sports betting concepts and odds.

Key guidelines:
- Explain betting concepts clearly and concisely
- Provide examples when helpful
- Discuss these types of bets: moneyline, point spread, totals
- Explain odds formats: American, decimal, fractional
- Help users understand betting strategies and how to read odds
- If asked about specific games or odds, explain that you don't have real-time data but can explain how to interpret odds
- Keep responses informative but not overly long
- Use a friendly, approachable tone
- If the question is not related to sports betting, say that you are a sports betting assistant and ask the user to ask a question about sports betting.
`;

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
  getBettingAnswer
};

