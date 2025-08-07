/**
 * Enabl Community Agent
 * 
 * Handles research queries, finds relevant health articles, and provides 
 * community insights on health and wellness topics.
 */

const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrockAgent = new BedrockAgentRuntimeClient({ region: process.env.REGION });
const bedrock = new BedrockRuntimeClient({ region: process.env.REGION });

exports.handler = async (event) => {
  try {
    const { message, userId, sessionId, context } = JSON.parse(event.body);
    
    console.log('Community Agent request:', { 
      userId, 
      sessionId, 
      messageLength: message?.length 
    });

    // System prompt for community agent
    const systemPrompt = `You are the Enabl Community Agent, specializing in health research, community insights, and evidence-based health information.

Your capabilities:
- Find and summarize relevant health research and studies
- Provide community insights on health trends and wellness topics
- Curate evidence-based health articles and resources
- Explain complex medical research in simple terms
- Connect users with relevant health communities and support groups
- Share preventive health measures based on current research
- Provide updates on health news and medical breakthroughs
- Offer insights from health and wellness communities

Guidelines:
- Always cite reputable sources and recent research
- Present balanced views on health topics
- Encourage critical thinking about health information
- Connect research findings to practical health applications
- Highlight when more research is needed on a topic
- Promote evidence-based health decisions
- Respect diverse health perspectives and experiences
- Focus on peer-reviewed and credible sources

Important: Always encourage users to discuss research findings with their healthcare providers for personalized guidance.`;

    // Analyze the message to determine research intent
    const intentAnalysis = await analyzeResearchIntent(message);
    
    let response = '';

    // Use Bedrock AgentCore for intelligent research and community insights
    try {
      const agentResponse = await generateAgentResponse(message, systemPrompt, intentAnalysis, userId);
      response = agentResponse.response;
    } catch (error) {
      console.log('AgentCore error, falling back to direct model:', error.message);
      
      // Fallback to direct Bedrock model if AgentCore is unavailable
      try {
        const bedrockResponse = await generateAIResponse(message, systemPrompt, intentAnalysis, userId);
        response = bedrockResponse.response;
      } catch (fallbackError) {
        console.log('Bedrock fallback error:', fallbackError.message);
        response = generateFallbackResponse(message, intentAnalysis);
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify({
        response: response,
        agentType: 'community-agent',
        sessionId: sessionId || `community-${userId}-${Date.now()}`,
        intent: intentAnalysis.intent,
        timestamp: new Date().toISOString(),
        citations: [
          'PubMed - Recent Research Studies',
          'Harvard Health Publishing - Evidence-Based Articles',
          'NIH National Institutes of Health - Research Papers',
          'CDC Research and Data - Community Health Insights',
          'WHO Global Health Observatory - Health Trends'
        ]
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
        error: 'Sorry, I had trouble finding research on that topic. Please try again.',
        agentType: 'community-agent',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

/**
 * Analyze user intent for research-related queries
 */
async function analyzeResearchIntent(message) {
  const messageLower = message.toLowerCase();
  
  const intents = {
    researchQuery: [
      'research', 'study', 'studies', 'evidence', 'findings', 'data',
      'clinical trial', 'meta-analysis', 'systematic review'
    ],
    newsAndTrends: [
      'news', 'latest', 'recent', 'breakthrough', 'discovery', 'trend',
      'update', 'development', 'advancement'
    ],
    communityInsights: [
      'community', 'people', 'others', 'experiences', 'stories',
      'support group', 'forum', 'discussion'
    ],
    comparison: [
      'compare', 'versus', 'vs', 'difference', 'better', 'best',
      'pros and cons', 'advantages', 'disadvantages'
    ],
    prevention: [
      'prevent', 'prevention', 'avoid', 'reduce risk', 'protect',
      'screening', 'early detection'
    ]
  };

  let detectedIntent = 'general';
  let confidence = 0;

  for (const [intent, keywords] of Object.entries(intents)) {
    const matches = keywords.filter(keyword => messageLower.includes(keyword));
    const currentConfidence = matches.length / keywords.length;
    
    if (currentConfidence > confidence) {
      confidence = currentConfidence;
      detectedIntent = intent;
    }
  }

  return {
    intent: detectedIntent,
    confidence,
    topic: extractTopic(message)
  };
}

/**
 * Extract the main health topic from the message
 */
function extractTopic(message) {
  const messageLower = message.toLowerCase();
  
  const healthTopics = [
    'diabetes', 'hypertension', 'heart disease', 'cancer', 'obesity',
    'mental health', 'depression', 'anxiety', 'sleep', 'nutrition',
    'exercise', 'covid', 'vaccine', 'pregnancy', 'aging', 'arthritis'
  ];
  
  for (const topic of healthTopics) {
    if (messageLower.includes(topic)) {
      return topic;
    }
  }
  
  return 'general health';
}

/**
 * Generate AI response using Bedrock AgentCore with research capabilities
 */
async function generateAgentResponse(message, systemPrompt, intentAnalysis, userId) {
  try {
    const agentInput = {
      inputText: message,
      sessionId: `community-agent-${userId}-${Date.now()}`,
      agentId: process.env.BEDROCK_COMMUNITY_AGENT_ID || 'default-community-agent',
      agentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID'
    };

    // Add research-specific session attributes
    const sessionAttributes = {
      userIntent: intentAnalysis.intent,
      confidence: intentAnalysis.confidence.toString(),
      researchTopic: intentAnalysis.topic,
      systemPrompt: systemPrompt
    };

    const command = new InvokeAgentCommand({
      ...agentInput,
      sessionAttributes,
      enableTrace: true
    });

    console.log('Invoking Community Agent with research query:', {
      inputText: message.substring(0, 100) + '...',
      topic: intentAnalysis.topic,
      intent: intentAnalysis.intent
    });

    const response = await bedrockAgent.send(command);
    
    let agentResponseText = '';
    let reasoningTrace = [];

    if (response.completion) {
      for await (const chunk of response.completion) {
        if (chunk.chunk && chunk.chunk.bytes) {
          const chunkText = new TextDecoder().decode(chunk.chunk.bytes);
          agentResponseText += chunkText;
        }
        
        if (chunk.trace) {
          reasoningTrace.push(chunk.trace);
        }
      }
    }

    return {
      response: agentResponseText || generateFallbackResponse(message, intentAnalysis),
      reasoningTrace,
      agentUsed: true
    };

  } catch (error) {
    console.error('Community AgentCore error:', error);
    throw error;
  }
}

/**
 * Generate AI response using direct Bedrock model (fallback)
 */
async function generateAIResponse(message, systemPrompt, intentAnalysis, userId) {
  try {
    const prompt = `${systemPrompt}

User Intent: ${intentAnalysis.intent}
Confidence: ${intentAnalysis.confidence}
Topic: ${intentAnalysis.topic}

User Message: "${message}"

Please provide a comprehensive response that includes relevant research, community insights, and evidence-based information on this topic.`;

    const command = new InvokeModelCommand({
      modelId: process.env.MODEL_ID || 'amazon.titan-text-express-v1',
      body: JSON.stringify({
        inputText: prompt,
        textGenerationConfig: {
          maxTokenCount: 1000,
          stopSequences: [],
          temperature: 0.7,
          topP: 0.9
        }
      }),
      contentType: 'application/json',
    });

    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    return {
      response: responseBody.results[0].outputText
    };
  } catch (error) {
    console.log('Bedrock error:', error.message);
    throw error; // Let the caller handle the fallback
  }
}

/**
 * Generate fallback response when Bedrock is unavailable
 */
function generateFallbackResponse(message, intentAnalysis) {
  const topic = intentAnalysis.topic;
  
  switch (intentAnalysis.intent) {
    case 'researchQuery':
      return `I'd be happy to help you find research on ${topic}. While I'm currently updating my research database, I recommend checking these trusted sources for the latest studies:\n\n📚 **Reliable Research Sources:**\n- PubMed.gov for peer-reviewed medical studies\n- CDC.gov for epidemiological data and health statistics\n- WHO.int for global health research and guidelines\n- ClinicalTrials.gov for ongoing and completed clinical trials\n\n💡 **Research Tips:**\n- Look for systematic reviews and meta-analyses for comprehensive overviews\n- Check publication dates for the most current findings\n- Consider the study size and methodology when evaluating results\n- Discuss findings with your healthcare provider for personalized guidance`;
      
    case 'newsAndTrends':
      return `Here are some reliable sources for the latest health news and trends on ${topic}:\n\n📰 **Trusted Health News Sources:**\n- Harvard Health Publishing\n- Mayo Clinic Health News\n- NIH News in Health\n- WebMD Health News\n- Medical News Today\n\n🔍 **What to Look For:**\n- Evidence-based reporting\n- Expert commentary from healthcare professionals\n- References to peer-reviewed research\n- Balanced coverage of benefits and risks\n\nAlways verify health news with your healthcare provider before making significant health decisions.`;
      
    case 'communityInsights':
      return `Community support and shared experiences can be valuable for understanding ${topic}. Here are some ways to connect with others:\n\n🤝 **Community Resources:**\n- Patient advocacy organizations\n- Support groups (both online and in-person)\n- Health-focused social communities\n- Professional health forums moderated by experts\n\n⚠️ **Important Reminders:**\n- Individual experiences vary greatly\n- What works for one person may not work for another\n- Always verify health advice with qualified healthcare professionals\n- Be cautious of unverified claims or miracle cures`;
      
    case 'prevention':
      return `Prevention is a key aspect of maintaining good health for ${topic}. Here are evidence-based prevention strategies:\n\n🛡️ **General Prevention Principles:**\n- Regular health screenings and check-ups\n- Maintaining a healthy lifestyle (diet, exercise, sleep)\n- Following vaccination schedules\n- Managing stress and mental health\n- Avoiding known risk factors\n\n📋 **For Specific Guidance:**\n- Consult with your healthcare provider for personalized prevention plans\n- Follow guidelines from reputable health organizations\n- Stay informed about risk factors specific to your health history\n- Consider genetic counseling if you have family history concerns`;
      
    default:
      return `I'm here to help you explore health research and community insights on ${topic}. While I'm currently updating my research database, I can guide you to the best resources:\n\n🔬 **Research & Evidence:**\n- Peer-reviewed scientific studies\n- Clinical trial results\n- Systematic reviews and meta-analyses\n- Evidence-based practice guidelines\n\n🌍 **Community Insights:**\n- Patient experiences and outcomes\n- Support group discussions\n- Healthcare provider perspectives\n- Public health data and trends\n\n💡 **Next Steps:**\n- Try asking me specific questions about research topics\n- Request information about health trends or news\n- Ask for community resources on specific conditions\n- Inquire about prevention strategies for health concerns`;
  }
}
