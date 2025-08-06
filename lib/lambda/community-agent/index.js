/**
 * Enabl Community AI Agent
 * 
 * Finds and curates relevant health articles, research, and community content
 * based on user interests and trending health topics.
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrock = new BedrockRuntimeClient({ region: process.env.REGION });

exports.handler = async (event) => {
  try {
    const { message, userId, sessionId, context } = JSON.parse(event.body);
    
    console.log('Community Agent request:', { userId, sessionId, messageLength: message?.length });

    // System prompt for community agent
    const systemPrompt = `You are the Enabl Community Assistant, specializing in finding and recommending relevant health articles, research studies, and community resources.

Your role:
- Find trustworthy health information and research
- Recommend articles from reputable medical sources
- Suggest community resources and support groups
- Provide evidence-based health insights
- Stay current with health trends and breakthrough research

Guidelines:
- Prioritize peer-reviewed research and medical sources
- Include links to original sources when possible
- Explain complex medical research in accessible language
- Recommend diverse perspectives and approaches
- Always note when information is preliminary or needs further research`;

    const prompt = `${systemPrompt}

User request: ${message}

User context: ${context || 'General health interest'}

Please provide relevant health articles, research findings, or community resources that would be helpful for this user. Include brief summaries and explain why each recommendation is valuable.`;

    // Use Titan Text for community content generation
    const command = new InvokeModelCommand({
      modelId: process.env.MODEL_ID,
      body: JSON.stringify({
        inputText: prompt,
        textGenerationConfig: {
          maxTokenCount: 1000,
          temperature: 0.7,
          topP: 0.9,
        },
      }),
    });

    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify({
        response: responseBody.results[0].outputText,
        agentType: 'community-agent',
        sessionId: sessionId || `community-${userId}-${Date.now()}`,
        recommendations: [], // TODO: Implement actual article/research recommendations
        timestamp: new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Community Agent error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Sorry, I had trouble finding community resources. Please try again.',
        agentType: 'community-agent',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
