/**
 * Chat Router Lambda Function
 * 
 * Routes incoming chat requests to the appropriate AI agent based on
 * intent analysis and user preferences.
 */

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambda = new LambdaClient({ region: process.env.REGION });

/**
 * Analyze user intent to determine which agent to use
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

    // Determine which agent to use
    const agentType = requestedAgent || analyzeIntent(message);
    const functionName = getFunctionName(agentType);
    
    if (!functionName) {
      throw new Error(`No function configured for agent type: ${agentType}`);
    }

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

    const response = await lambda.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.Payload));
    
    // Add routing metadata
    if (result.body) {
      const responseBody = JSON.parse(result.body);
      responseBody.routedTo = agentType;
      responseBody.routingDecision = requestedAgent ? 'explicit' : 'inferred';
      result.body = JSON.stringify(responseBody);
    }

    return result;

  } catch (error) {
    console.error('Chat Router error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Unable to route your request. Please try again.',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
