/**
 * Enabl Health Assistant AI Agent
 * 
 * Main health assistant that provides personalized health guidance,
 * medication reminders, and general health information using RAG.
 */

const { BedrockRuntimeClient, RetrieveAndGenerateCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrock = new BedrockRuntimeClient({ region: process.env.REGION });

exports.handler = async (event) => {
  try {
    const { message, userId, sessionId, context } = JSON.parse(event.body);
    
    console.log('Health Assistant request:', { userId, sessionId, messageLength: message?.length });

    // System prompt for health assistant
    const systemPrompt = `You are Enabl, an AI-powered health assistant. You provide helpful, accurate health information while being empathetic and supportive. 

Key guidelines:
- Always remind users to consult healthcare professionals for serious concerns
- Provide evidence-based health information
- Be encouraging and supportive
- Respect user privacy and confidentiality
- Use the knowledge base to provide personalized recommendations when available

User context: ${context || 'No additional context provided'}`;

    // Use Bedrock's retrieve and generate for RAG
    const command = new RetrieveAndGenerateCommand({
      input: {
        text: message,
      },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID,
          modelArn: `arn:aws:bedrock:${process.env.REGION}::foundation-model/${process.env.MODEL_ID}`,
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: 5,
            },
          },
          generationConfiguration: {
            promptTemplate: {
              textPromptTemplate: `${systemPrompt}

Context from knowledge base:
$search_results$

User Question: $query$

Please provide a helpful, accurate response based on the context above. If the context doesn't contain relevant information, provide general health guidance while encouraging the user to consult with healthcare professionals.`
            },
          },
        },
      },
      sessionId: sessionId || `health-${userId}-${Date.now()}`,
    });

    const response = await bedrock.send(command);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify({
        response: response.output.text,
        agentType: 'health-assistant',
        sessionId: response.sessionId,
        citations: response.citations || [],
        timestamp: new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Health Assistant error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Sorry, I encountered an issue processing your request. Please try again.',
        agentType: 'health-assistant',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
