/**
 * Chat Router Lambda Function
 * 
 * Routes incoming chat requests to the appropriate AI agent based on
 * intent analysis and user preferences.
 */

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');

const lambda = new LambdaClient({ region: process.env.REGION });
const bedrockAgent = new BedrockAgentRuntimeClient({ region: process.env.REGION });

/**
 * Use Bedrock AgentCore for intelligent agent selection
 */
async function intelligentAgentSelection(message, userId) {
  try {
    const agentInput = {
      inputText: `Analyze this user message and determine which health AI agent should handle it:

Message: "${message}"

Available agents:
- health-assistant: General health questions, symptoms, wellness advice
- appointment-agent: Scheduling, medication reminders, calendar management
- community-agent: Research, studies, health news, community insights
- document-agent: Document analysis, medical report interpretation

Respond with only the agent name.`,
      sessionId: `chat-router-${userId}-${Date.now()}`,
      agentId: process.env.BEDROCK_ROUTER_AGENT_ID || 'default-router-agent',
      agentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID'
    };

    const command = new InvokeAgentCommand({
      ...agentInput,
      enableTrace: true
    });

    const response = await bedrockAgent.send(command);
    
    let agentSelection = '';
    if (response.completion) {
      for await (const chunk of response.completion) {
        if (chunk.chunk && chunk.chunk.bytes) {
          const chunkText = new TextDecoder().decode(chunk.chunk.bytes);
          agentSelection += chunkText;
        }
      }
    }

    // Parse the agent selection and validate
    const selectedAgent = agentSelection.trim().toLowerCase();
    const validAgents = ['health-assistant', 'appointment-agent', 'community-agent', 'document-agent'];
    
    if (validAgents.includes(selectedAgent)) {
      return selectedAgent;
    } else {
      console.log('Invalid agent selection from AgentCore:', selectedAgent);
      throw new Error('Invalid agent selection');
    }

  } catch (error) {
    console.error('AgentCore intelligent routing error:', error);
    throw error;
  }
}

/**
 * Fallback intent analysis when AgentCore is unavailable
 */
function analyzeIntent(message) {
  const message_lower = message.toLowerCase();
  
  // Appointment and medication keywords
  if (message_lower.includes('appointment') || 
      message_lower.includes('reminder') || 
      message_lower.includes('medication') || 
      message_lower.includes('schedule') ||
      message_lower.includes('checkup') ||
      message_lower.includes('follow-up') ||
      message_lower.includes('calendar') ||
      message_lower.includes('remind me') ||
      message_lower.includes('pill') ||
      message_lower.includes('prescription') ||
      message_lower.includes('refill')) {
    return 'appointment-agent';
  }
  
  // Health-related keywords
  if (message_lower.includes('symptom') || 
      message_lower.includes('health') ||
      message_lower.includes('doctor') ||
      message_lower.includes('pain') ||
      message_lower.includes('feel') ||
      message_lower.includes('hurt')) {
    return 'health-assistant';
  }
  
  // Community/research keywords
  if (message_lower.includes('article') ||
      message_lower.includes('research') ||
      message_lower.includes('study') ||
      message_lower.includes('news') ||
      message_lower.includes('community')) {
    return 'community-agent';
  }
  
  // Document-related keywords
  if (message_lower.includes('document') ||
      message_lower.includes('file') ||
      message_lower.includes('upload') ||
      message_lower.includes('analyze') ||
      message_lower.includes('report') ||
      message_lower.includes('result')) {
    return 'document-agent';
  }
  
  // Default to health assistant
  return 'health-assistant';
}

/**
 * Get function name for the specified agent
 */
function getFunctionName(agentType) {
  switch (agentType) {
    case 'health-assistant':
      return process.env.HEALTH_ASSISTANT_FUNCTION;
    case 'community-agent':
      return process.env.COMMUNITY_AGENT_FUNCTION;
    case 'document-agent':
      return process.env.DOCUMENT_AGENT_FUNCTION;
    case 'appointment-agent':
      return process.env.APPOINTMENT_AGENT_FUNCTION;
    default:
      return process.env.HEALTH_ASSISTANT_FUNCTION;
  }
}

exports.handler = async (event) => {
  try {
    const { message, userId, agentType: requestedAgent, sessionId, context } = JSON.parse(event.body);
    
    console.log('Chat Router request:', { 
      userId, 
      requestedAgent, 
      sessionId,
      messageLength: message?.length 
    });

    // Determine which agent to use with AgentCore intelligence
    let agentType;
    
    if (requestedAgent && requestedAgent !== 'auto') {
      agentType = requestedAgent;
    } else {
      try {
        // Use AgentCore for intelligent agent routing
        agentType = await intelligentAgentSelection(message, userId);
        console.log('AgentCore selected agent:', agentType);
      } catch (error) {
        console.log('AgentCore routing failed, using fallback analysis:', error.message);
        agentType = analyzeIntent(message);
      }
    }
    const functionName = getFunctionName(agentType);

    console.log('Agent routing decision:', {
      requestedAgent,
      determinedAgent: agentType,
      functionName,
      messagePreview: message?.substring(0, 50) + '...'
    });

    // Prepare payload for the target agent
    const payload = {
      body: JSON.stringify({
        message,
        userId,
        sessionId,
        context,
        routedFrom: 'chat-router',
        agentType,
      }),
      headers: event.headers,
      requestContext: event.requestContext,
    };

    // Invoke the appropriate agent function
    const command = new InvokeCommand({
      FunctionName: functionName,
      Payload: JSON.stringify(payload),
    });

    let response;
    try {
      response = await lambda.send(command);
    } catch (invokeError) {
      // If the agent function doesn't exist, provide a fallback response
      if (invokeError.name === 'ResourceNotFoundException') {
        console.log(`Agent function ${functionName} not found, providing fallback response`);
        
        const fallbackResponse = {
          response: `Hello! I'm your Enabl AI assistant (${agentType}). You said: "${message}". I'm currently being set up to provide you with personalized health assistance. This is a test response with proper CORS headers.`,
          agentType: agentType,
          sessionId: sessionId || `session-${Date.now()}`,
          timestamp: new Date().toISOString(),
          routedTo: agentType,
          routingDecision: requestedAgent ? 'explicit' : 'inferred',
          status: 'fallback-response'
        };

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
          },
          body: JSON.stringify(fallbackResponse),
        };
      }
      throw invokeError; // Re-throw if it's not a ResourceNotFoundException
    }

    const result = JSON.parse(new TextDecoder().decode(response.Payload));
    
    // Add routing metadata
    if (result.body) {
      const responseBody = JSON.parse(result.body);
      responseBody.routedTo = agentType;
      responseBody.routingDecision = requestedAgent ? 'explicit' : 'inferred';
      result.body = JSON.stringify(responseBody);
    }

    // Ensure CORS headers are present
    if (!result.headers) {
      result.headers = {};
    }
    result.headers['Access-Control-Allow-Origin'] = '*';
    result.headers['Access-Control-Allow-Headers'] = 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token';
    result.headers['Access-Control-Allow-Methods'] = 'OPTIONS,POST';

    return result;

  } catch (error) {
    console.error('Chat Router error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'OPTIONS,POST',
      },
      body: JSON.stringify({
        error: 'Unable to route your request. Please try again.',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
