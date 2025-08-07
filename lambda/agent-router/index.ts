/**
 * Enabl Health AI Agent Router Lambda
 * Routes incoming requests to the appropriate Bedrock AgentCore specialist
 * 
 * @author Enabl Health Team
 * @date August 7, 2025
 */

import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';

// Agent Runtime ARNs for Bedrock AgentCore
const AGENT_RUNTIME_ARNS = {
  'health-assistant': 'arn:aws:bedrock-agentcore:us-east-1:775525057465:runtime/enabl_health_assistant-n4fjFu7zbr',
  'appointment-agent': 'arn:aws:bedrock-agentcore:us-east-1:775525057465:runtime/enabl_appointment_agent-b706co2k7E',
  'community-agent': 'arn:aws:bedrock-agentcore:us-east-1:775525057465:runtime/enabl_community_agent-IfByIqFlkW',
  'document-agent': 'arn:aws:bedrock-agentcore:us-east-1:775525057465:runtime/enabl_document_agent-iC7RtgHCJJ'
} as const;

// Agent-specific system prompts
const AGENT_PROMPTS = {
  'health-assistant': `You are Enabl Health Assistant, a HIPAA-compliant AI health advisor. Provide personalized health insights, symptom analysis, and wellness recommendations. Always remind users to consult healthcare professionals for serious concerns.`,
  'appointment-agent': `You are Enabl Appointment Agent, specialized in healthcare scheduling. Help users book, reschedule, or manage medical appointments. Integrate with calendar systems and provide appointment reminders.`,
  'community-agent': `You are Enabl Community Agent, focused on health and wellness content curation. Find and share relevant health articles, research, and community discussions on wellness topics.`,
  'document-agent': `You are Enabl Document Agent, specialized in medical document analysis and management. Help users organize, analyze, and extract insights from health records and medical documents.`
} as const;

// Agent Selection Keywords
const AGENT_KEYWORDS = {
  'health-assistant': [
    'symptom', 'symptoms', 'pain', 'fever', 'headache', 'nausea', 'fatigue',
    'health', 'wellness', 'medical', 'diagnosis', 'treatment', 'medication',
    'doctor', 'physician', 'nurse', 'hospital', 'clinic', 'emergency',
    'sick', 'illness', 'disease', 'condition', 'feel', 'feeling'
  ],
  'appointment-agent': [
    'appointment', 'schedule', 'calendar', 'book', 'booking', 'reschedule',
    'cancel', 'reminder', 'notification', 'availability', 'available',
    'doctor visit', 'checkup', 'follow-up', 'meeting', 'consultation',
    'time', 'date', 'when', 'tomorrow', 'today', 'next week'
  ],
  'community-agent': [
    'research', 'study', 'studies', 'article', 'news', 'community',
    'forum', 'discussion', 'share', 'experience', 'others', 'people',
    'evidence', 'scientific', 'clinical', 'trial', 'publication',
    'latest', 'new', 'recent', 'update', 'trend', 'insight'
  ],
  'document-agent': [
    'document', 'report', 'file', 'upload', 'analyze', 'analysis',
    'medical record', 'lab result', 'test result', 'scan', 'x-ray',
    'blood work', 'biopsy', 'pathology', 'interpretation', 'review',
    'pdf', 'image', 'attachment', 'chart', 'history'
  ]
};

interface AgentRequest {
  message: string;
  userId?: string;
  sessionId?: string;
  agentType?: string; // Optional explicit agent selection
  context?: Record<string, any>;
}

interface AgentResponse {
  response: string;
  agentUsed: string;
  confidence: number;
  sessionId: string;
  timestamp: string;
}

/**
 * Determines the most appropriate agent based on message content
 */
function selectAgent(message: string, explicitAgent?: string): string {
  if (explicitAgent && explicitAgent in AGENT_RUNTIME_ARNS) {
    return explicitAgent;
  }

  const messageLower = message.toLowerCase();
  const scores: Record<string, number> = {};

  // Calculate keyword match scores for each agent
  Object.entries(AGENT_KEYWORDS).forEach(([agentType, keywords]) => {
    scores[agentType] = keywords.reduce((score, keyword) => {
      return score + (messageLower.includes(keyword) ? 1 : 0);
    }, 0);
  });

  // Find agent with highest score
  const bestAgent = Object.entries(scores).reduce((best, [agent, score]) => {
    return score > best.score ? { agent, score } : best;
  }, { agent: 'health-assistant', score: 0 });

  // Default to health-assistant if no clear match
  return bestAgent.score > 0 ? bestAgent.agent : 'health-assistant';
}

/**
 * Main Lambda handler
 */
export const handler = async (event: any): Promise<any> => {
  const agentCoreClient = new BedrockAgentCoreClient({ region: 'us-east-1' });
  
  try {
    const request: AgentRequest = JSON.parse(event.body || '{}');
    const { message, userId, sessionId, agentType, context } = request;

    if (!message) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Message is required'
        })
      };
    }

    // Select appropriate agent
    const selectedAgent = selectAgent(message, agentType);
    const agentRuntimeArn = AGENT_RUNTIME_ARNS[selectedAgent as keyof typeof AGENT_RUNTIME_ARNS];

    console.log(`Routing to agent: ${selectedAgent} for user: ${userId}`);
    console.log(`Agent Runtime ARN: ${agentRuntimeArn}`);
    console.log(`Message: ${message}`);

    // Prepare payload as per AgentCore documentation
    const inputText: string = message;
    const runtimeSessionId = sessionId || `session-${Date.now()}`;

    // Invoke the AgentCore runtime using the command pattern
    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: agentRuntimeArn,
      // No qualifier - use the agent runtime directly
      payload: inputText
    });

    const response = await agentCoreClient.send(command);

    // Handle the AgentCore response
    let responseText = 'I apologize, but I encountered an issue processing your request.';
    
    console.log('AgentCore Response:', JSON.stringify(response, null, 2));
    
    // Try different possible response properties
    const responseObj = response as any;
    if (responseObj.response) {
      if (typeof responseObj.response === 'string') {
        responseText = responseObj.response;
      } else if (responseObj.response instanceof Uint8Array) {
        responseText = new TextDecoder().decode(responseObj.response);
      }
    } else if (responseObj.payload) {
      if (typeof responseObj.payload === 'string') {
        responseText = responseObj.payload;
      } else if (responseObj.payload instanceof Uint8Array) {
        responseText = new TextDecoder().decode(responseObj.payload);
      }
    } else if (responseObj.body) {
      if (typeof responseObj.body === 'string') {
        responseText = responseObj.body;
      } else if (responseObj.body instanceof Uint8Array) {
        responseText = new TextDecoder().decode(responseObj.body);
      }
    }
    
    const result: AgentResponse = {
      response: responseText,
      agentUsed: selectedAgent,
      confidence: 0.85,
      sessionId: runtimeSessionId,
      timestamp: new Date().toISOString()
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Agent Router Error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to process agent request'
      })
    };
  }
};

/**
 * Health check endpoint
 */
export const healthCheck = async (): Promise<any> => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      status: 'healthy',
      agents: Object.keys(AGENT_RUNTIME_ARNS),
      timestamp: new Date().toISOString()
    })
  };
};

/**
 * Get available agents
 */
export const getAgents = async (): Promise<any> => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      agents: {
        'health-assistant': {
          name: 'Health Assistant',
          description: 'General health guidance and symptom assessment',
          arn: AGENT_RUNTIME_ARNS['health-assistant']
        },
        'appointment-agent': {
          name: 'Appointment Agent',
          description: 'Medication reminders and appointment scheduling',
          arn: AGENT_RUNTIME_ARNS['appointment-agent']
        },
        'community-agent': {
          name: 'Community Agent',
          description: 'Health research and community insights',
          arn: AGENT_RUNTIME_ARNS['community-agent']
        },
        'document-agent': {
          name: 'Document Agent',
          description: 'Medical document analysis and interpretation',
          arn: AGENT_RUNTIME_ARNS['document-agent']
        }
      }
    })
  };
};
