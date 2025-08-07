/**
 * Enabl Health Assistant AI Agent
 * 
 * Handles general health questions, symptom guidance, and wellness information.
 * Provides evidence-based health information while encouraging professional medical consultation.
 */

const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrockAgent = new BedrockAgentRuntimeClient({ region: process.env.REGION });
const bedrock = new BedrockRuntimeClient({ region: process.env.REGION });

exports.handler = async (event) => {
  try {
    const { message, userId, sessionId, context } = JSON.parse(event.body);
    
    console.log('Health Assistant request:', { 
      userId, 
      sessionId, 
      messageLength: message?.length 
    });

    // System prompt for health assistant
    const systemPrompt = `You are the Enabl Health Assistant, providing general health information and wellness guidance.

Your capabilities:
- Answer general health questions with evidence-based information
- Provide symptom guidance and when to seek medical care
- Offer wellness tips and preventive health advice
- Explain medical terminology and common health concepts
- Guide users on when to consult healthcare professionals
- Provide mental health support and stress management tips
- Offer nutrition and exercise guidance
- Help with health risk assessment

Guidelines:
- Always remind users that you're not a substitute for professional medical advice
- Encourage users to consult healthcare providers for specific medical concerns
- Provide balanced, evidence-based information from reputable sources
- Be empathetic and supportive while maintaining professional boundaries
- Focus on general wellness and prevention
- Avoid diagnosing or prescribing treatments
- Provide clear disclaimers about medical advice limitations

Important: For urgent symptoms or medical emergencies, always advise users to seek immediate medical attention.`;

    // Analyze the message to determine the type of health inquiry
    const intentAnalysis = await analyzeHealthIntent(message);
    
    let response = '';

    // Use Bedrock AgentCore for intelligent health assistance with reasoning
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
        agentType: 'health-assistant',
        sessionId: sessionId || `health-${userId}-${Date.now()}`,
        intent: intentAnalysis.intent,
        timestamp: new Date().toISOString(),
        citations: [
          'CDC Health Guidelines - General Health Information',
          'Mayo Clinic - Symptom Checker and Health Information',
          'WHO Health Recommendations and Guidelines',
          'NIH National Institutes of Health - Health Resources'
        ]
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
        error: 'Sorry, I had trouble processing your health question. Please try again.',
        agentType: 'health-assistant',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

/**
 * Analyze user intent for health-related queries
 */
async function analyzeHealthIntent(message) {
  const messageLower = message.toLowerCase();
  
  const intents = {
    symptomInquiry: [
      'symptom', 'pain', 'hurt', 'ache', 'feel', 'headache', 'fever',
      'nausea', 'dizzy', 'tired', 'fatigue', 'cough', 'sore'
    ],
    generalHealth: [
      'health', 'healthy', 'wellness', 'fitness', 'exercise',
      'diet', 'nutrition', 'sleep', 'stress'
    ],
    medicalInformation: [
      'what is', 'explain', 'define', 'meaning', 'cause', 'treatment',
      'condition', 'disease', 'disorder'
    ],
    mentalHealth: [
      'anxiety', 'depression', 'stress', 'mental health', 'mood',
      'emotional', 'feeling', 'worried', 'sad'
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
    urgencyLevel: assessUrgency(message)
  };
}

/**
 * Assess urgency level of health inquiry
 */
function assessUrgency(message) {
  const messageLower = message.toLowerCase();
  
  const urgentKeywords = [
    'emergency', 'urgent', 'severe', 'sudden', 'intense',
    'can\'t breathe', 'chest pain', 'bleeding', 'unconscious'
  ];
  
  const moderateKeywords = [
    'persistent', 'worsening', 'ongoing', 'recurring'
  ];
  
  if (urgentKeywords.some(keyword => messageLower.includes(keyword))) {
    return 'high';
  } else if (moderateKeywords.some(keyword => messageLower.includes(keyword))) {
    return 'moderate';
  }
  
  return 'low';
}

/**
 * Generate AI response using Bedrock AgentCore with advanced health reasoning
 */
async function generateAgentResponse(message, systemPrompt, intentAnalysis, userId) {
  try {
    const agentInput = {
      inputText: message,
      sessionId: `health-assistant-${userId}-${Date.now()}`,
      agentId: process.env.BEDROCK_HEALTH_AGENT_ID || 'default-health-agent',
      agentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID'
    };

    // Add health-specific session attributes
    const sessionAttributes = {
      userIntent: intentAnalysis.intent,
      urgencyLevel: intentAnalysis.urgencyLevel,
      confidence: intentAnalysis.confidence.toString(),
      healthTopic: intentAnalysis.topic,
      systemPrompt: systemPrompt
    };

    const command = new InvokeAgentCommand({
      ...agentInput,
      sessionAttributes,
      enableTrace: true
    });

    console.log('Invoking Health Agent with input:', {
      inputText: message.substring(0, 100) + '...',
      urgencyLevel: intentAnalysis.urgencyLevel,
      topic: intentAnalysis.topic
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
    console.error('Health AgentCore error:', error);
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
Urgency Level: ${intentAnalysis.urgencyLevel}

User Message: "${message}"

Please provide a helpful, evidence-based response that addresses the user's health question while encouraging appropriate medical consultation when needed.`;

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
  const messageLower = message.toLowerCase();
  
  // High urgency response
  if (intentAnalysis.urgencyLevel === 'high') {
    return "⚠️ If you're experiencing a medical emergency, please call 911 or go to your nearest emergency room immediately. For urgent symptoms like severe chest pain, difficulty breathing, or severe bleeding, don't wait - seek immediate medical attention.";
  }
  
  // Intent-specific responses
  switch (intentAnalysis.intent) {
    case 'symptomInquiry':
      if (messageLower.includes('headache') || messageLower.includes('head')) {
        return "I understand you're experiencing headaches. Headaches can be caused by various factors including stress, dehydration, lack of sleep, tension, or eye strain. For relief, try staying hydrated, getting adequate rest, managing stress levels, and ensuring proper posture. If headaches are persistent, severe, or accompanied by other concerning symptoms, please consult with a healthcare professional for proper evaluation.";
      }
      if (messageLower.includes('pain')) {
        return "Pain can have many different causes and varies greatly in severity and type. For minor aches and pains, rest, gentle movement, and over-the-counter pain relievers (as directed) may help. However, persistent, severe, or worsening pain should be evaluated by a healthcare professional to determine the underlying cause and appropriate treatment.";
      }
      return "I understand you're experiencing symptoms. While I can provide general health information, it's important to consult with a healthcare professional for proper evaluation of your specific symptoms. They can provide personalized advice based on your medical history and current condition.";
      
    case 'mentalHealth':
      return "Mental health is just as important as physical health. If you're experiencing anxiety, stress, or mood concerns, there are resources available to help. Some strategies that may help include regular exercise, maintaining a consistent sleep schedule, practicing mindfulness or relaxation techniques, and staying connected with supportive people. For persistent or severe mental health concerns, please consider reaching out to a mental health professional or your healthcare provider.";
      
    case 'generalHealth':
      return "Maintaining good health involves a combination of regular exercise, balanced nutrition, adequate sleep, stress management, and regular medical check-ups. Focus on incorporating whole foods, staying hydrated, being physically active, and getting 7-9 hours of quality sleep. For personalized health advice, consider consulting with your healthcare provider or a registered dietitian.";
      
    default:
      return "Thank you for your health question. I'm here to provide general health information and guidance. While I can offer evidence-based information, please remember that I'm not a substitute for professional medical advice. For specific health concerns, symptoms, or medical questions, it's always best to consult with your healthcare provider who can give you personalized advice based on your individual situation.\n\n💡 **Tip**: For the best experience, try asking me specific questions like:\n- 'What causes headaches?' (Health information)\n- 'I need to schedule an appointment' (Appointment agent)\n- 'Find research about sleep disorders' (Community agent)\n- 'Help me understand my lab results' (Document agent)";
  }
}
