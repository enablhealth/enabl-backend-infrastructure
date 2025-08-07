# Amazon Bedrock AgentCore Integration Guide

## Overview

This implementation leverages **Amazon Bedrock AgentCore** to provide advanced AI reasoning, planning, and task completion capabilities for the Enabl Health AI agents.

## Architecture Benefits

### 🧠 **Advanced Reasoning**
- **Multi-step thinking**: Agents can break down complex health queries into logical steps
- **Context awareness**: Maintains conversation context and user history
- **Intent understanding**: Deep analysis of user needs beyond keyword matching

### 🎯 **Planning & Execution**
- **Task decomposition**: Complex requests are broken into manageable actions
- **Action orchestration**: Agents can coordinate multiple tasks (e.g., schedule appointment + set reminder)
- **Error recovery**: Built-in error handling and alternative planning paths

### 🔍 **Intelligent Routing**
- **Dynamic agent selection**: AgentCore analyzes messages to route to the most appropriate specialist
- **Context-driven decisions**: Routing considers conversation history and user preferences
- **Fallback mechanisms**: Graceful degradation when AgentCore is unavailable

## Agent Specializations

### 1. Health Assistant Agent
```javascript
// AgentCore provides:
- Symptom analysis with urgency assessment
- Multi-step health guidance
- Personalized wellness recommendations
- Risk factor evaluation
```

### 2. Appointment Agent
```javascript
// AgentCore enables:
- Complex scheduling logic with conflict resolution
- Multi-medication reminder orchestration
- Calendar integration across platforms
- Proactive health maintenance scheduling
```

### 3. Community Agent
```javascript
// AgentCore powers:
- Research synthesis from multiple sources
- Evidence-based recommendation ranking
- Community insight aggregation
- Trend analysis and pattern recognition
```

### 4. Document Agent
```javascript
// AgentCore facilitates:
- Multi-document analysis and comparison
- Medical terminology explanation chains
- Pattern recognition in health data
- Intelligent document categorization
```

## Implementation Features

### Reasoning Traces
```javascript
// Enable trace logging for debugging
enableTrace: true

// Capture reasoning steps
if (chunk.trace && chunk.trace.orchestrationTrace) {
  const rationale = chunk.trace.orchestrationTrace.rationale.text;
  reasoningTrace.push(rationale);
}
```

### Session Management
```javascript
// Maintain context across interactions
sessionAttributes: {
  userIntent: intentAnalysis.intent,
  urgencyLevel: intentAnalysis.urgencyLevel,
  healthTopic: intentAnalysis.topic,
  systemPrompt: systemPrompt
}
```

### Action Extraction
```javascript
// Parse agent reasoning for actionable items
function extractActionsFromRationale(rationale, intentAnalysis) {
  // AgentCore reasoning → Executable actions
  // "create reminder" → { type: 'create_reminder', priority: 'high' }
  // "schedule appointment" → { type: 'schedule_appointment', priority: 'high' }
}
```

## Error Handling & Fallbacks

### Three-Tier Fallback System
1. **Primary**: Bedrock AgentCore with advanced reasoning
2. **Secondary**: Direct Amazon Titan models
3. **Tertiary**: Static intelligent responses

```javascript
try {
  // 1. Try AgentCore first
  const agentResponse = await generateAgentResponse(...);
  response = agentResponse.response;
} catch (error) {
  try {
    // 2. Fallback to direct model
    const bedrockResponse = await generateAIResponse(...);
    response = bedrockResponse.response;
  } catch (fallbackError) {
    // 3. Use intelligent static responses
    response = generateFallbackResponse(...);
  }
}
```

## Amazon Models Integration

### Recommended Models
- **Primary**: `amazon.titan-text-express-v1` - Fast, efficient, cost-effective
- **Alternative**: `amazon.titan-text-premier-v1:0` - Advanced reasoning for complex cases
- **Lightweight**: `amazon.titan-text-lite-v1` - Simple queries, minimal latency

### Model Configuration
```javascript
const command = new InvokeModelCommand({
  modelId: process.env.MODEL_ID || 'amazon.titan-text-express-v1',
  body: JSON.stringify({
    inputText: prompt,
    textGenerationConfig: {
      maxTokenCount: 1000,
      stopSequences: [],
      temperature: 0.7,   // Balanced creativity vs consistency
      topP: 0.9          // Focused but flexible responses
    }
  }),
  contentType: 'application/json',
});
```

## Deployment Configuration

### Environment Variables
```bash
# Core AgentCore Configuration
BEDROCK_AGENT_ID=your-agent-id
BEDROCK_AGENT_ALIAS_ID=TSTALIASID
BEDROCK_ROUTER_AGENT_ID=your-router-agent-id

# Amazon Model Selection
MODEL_ID=amazon.titan-text-express-v1

# AWS Configuration
REGION=us-east-1
```

### CDK Stack Integration
```typescript
// Add to your CDK Lambda function configuration
environment: {
  BEDROCK_AGENT_ID: 'your-agent-id',
  BEDROCK_AGENT_ALIAS_ID: 'TSTALIASID',
  MODEL_ID: 'amazon.titan-text-express-v1',
  REGION: 'us-east-1'
}
```

## Performance Optimizations

### 1. Parallel Processing
```javascript
// Process multiple agents simultaneously when appropriate
const [healthResponse, appointmentCheck] = await Promise.all([
  generateAgentResponse(healthQuery, ...),
  checkAppointmentAvailability(...)
]);
```

### 2. Context Caching
```javascript
// Reuse session context for related queries
sessionId: `${agentType}-${userId}-${conversationId}`
```

### 3. Response Streaming
```javascript
// Stream responses for better UX
for await (const chunk of response.completion) {
  if (chunk.chunk && chunk.chunk.bytes) {
    const chunkText = new TextDecoder().decode(chunk.chunk.bytes);
    // Stream to frontend
  }
}
```

## Security & Compliance

### HIPAA Compliance
- ✅ Amazon Bedrock is HIPAA eligible
- ✅ All data processed within AWS infrastructure
- ✅ Encryption in transit and at rest
- ✅ Access logging and audit trails

### Data Privacy
- ✅ No data sent to external AI providers
- ✅ User data remains in your AWS account
- ✅ Session isolation and secure processing
- ✅ Configurable data retention policies

## Monitoring & Debugging

### CloudWatch Integration
```javascript
// Automatic logging of agent decisions
console.log('AgentCore selected agent:', selectedAgent);
console.log('Reasoning trace steps:', reasoningTrace.length);
console.log('Action items generated:', actionItems.length);
```

### Performance Metrics
- Agent selection accuracy
- Response generation time
- Fallback frequency
- User satisfaction scores

## Cost Optimization

### Request Efficiency
- **AgentCore**: Pay per inference, optimized for complex reasoning
- **Direct Models**: Lower cost for simple queries
- **Fallbacks**: Zero cost for static responses

### Usage Patterns
- Route simple queries to direct models
- Use AgentCore for complex multi-step tasks
- Implement intelligent caching for repeated queries

## Next Steps

1. **Deploy AgentCore Agents**: Set up specialized agents in Bedrock console
2. **Configure Environment**: Update Lambda environment variables
3. **Test Integration**: Verify agent routing and fallback mechanisms
4. **Monitor Performance**: Set up CloudWatch dashboards
5. **Optimize Costs**: Fine-tune model selection based on usage patterns

This implementation provides production-ready AI agents with advanced reasoning capabilities while maintaining cost efficiency and HIPAA compliance for health data processing.
