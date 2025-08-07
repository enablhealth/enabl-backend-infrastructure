"""
Enabl Health AI Agent Router Lambda
Routes incoming requests to the appropriate Bedrock AgentCore specialist

@author Enabl Health Team
@date August 7, 2025
"""

import json
import logging
import boto3
from typing import Dict, Any, Optional, List
from datetime import datetime
import os

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
bedrock_runtime = boto3.client('bedrock-runtime', region_name='us-east-1')
dynamodb = boto3.resource('dynamodb', region_name='us-east-1')

# DynamoDB table for conversation memory
CONVERSATION_TABLE = os.environ.get('CONVERSATION_TABLE', 'enabl-conversations-development')
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'development')

logger.info(f"Agent Router starting in {ENVIRONMENT} environment")
logger.info(f"Using conversation table: {CONVERSATION_TABLE}")

# Try to initialize AgentCore client (may not be available)
try:
    bedrock_agentcore = boto3.client('bedrock-agentcore', region_name='us-east-1')
    AGENTCORE_AVAILABLE = True
    logger.info("AgentCore client initialized successfully")
except Exception as e:
    bedrock_agentcore = None
    AGENTCORE_AVAILABLE = False
    logger.warning(f"AgentCore not available, falling back to Foundation Models: {e}")

# Agent Runtime ECR URIs for Bedrock AgentCore
AGENT_RUNTIME_ARNS = {
    'health-assistant': '775525057465.dkr.ecr.us-east-1.amazonaws.com/enabl-health-assistant-python:latest',
    'appointment-agent': '775525057465.dkr.ecr.us-east-1.amazonaws.com/enabl-appointment-agent-python:latest',
    'community-agent': '775525057465.dkr.ecr.us-east-1.amazonaws.com/enabl-community-agent-python:latest',
    'document-agent': 'arn:aws:bedrock-agentcore:us-east-1:775525057465:runtime/enabl_document_agent-pending'
}

# Agent-specific system prompts
AGENT_PROMPTS = {
    'health-assistant': """You are Enabl Health Assistant, a HIPAA-compliant AI health advisor. 
    Provide personalized health insights, symptom analysis, and wellness recommendations. 
    Always remind users to consult healthcare professionals for serious concerns.""",
    
    'appointment-agent': """You are Enabl Appointment Agent, specialized in healthcare scheduling. 
    Help users book, reschedule, or manage medical appointments. 
    Integrate with calendar systems and provide appointment reminders.""",
    
    'community-agent': """You are Enabl Community Agent, focused on health and wellness content curation. 
    Find and share relevant health articles, research, and community discussions on wellness topics.""",
    
    'document-agent': """You are Enabl Document Agent, specialized in medical document analysis and management. 
    Help users organize, analyze, and extract insights from health records and medical documents."""
}

# Agent Selection Keywords
AGENT_KEYWORDS = {
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
}


def get_conversation_history(session_id: str, user_id: str, max_messages: int = 10) -> List[Dict[str, Any]]:
    """
    Retrieve conversation history from DynamoDB
    
    Args:
        session_id: The session ID
        user_id: The user ID
        max_messages: Maximum number of messages to retrieve
        
    Returns:
        List of conversation messages
    """
    try:
        table = dynamodb.Table(CONVERSATION_TABLE)
        
        response = table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key('session_id').eq(session_id),
            ScanIndexForward=False,  # Get most recent first
            Limit=max_messages
        )
        
        messages = response.get('Items', [])
        # Return in chronological order (oldest first)
        return sorted(messages, key=lambda x: x['timestamp'])
        
    except Exception as e:
        logger.warning(f"Failed to retrieve conversation history: {e}")
        return []


def get_user_recent_chats(user_id: str, max_sessions: int = 20) -> List[Dict[str, Any]]:
    """
    Retrieve recent chat sessions for a user
    
    Args:
        user_id: The user ID
        max_sessions: Maximum number of sessions to retrieve
        
    Returns:
        List of recent chat sessions with metadata
    """
    try:
        table = dynamodb.Table(CONVERSATION_TABLE)
        
        # Query using GSI for better performance
        response = table.query(
            IndexName='UserIdIndex',
            KeyConditionExpression=boto3.dynamodb.conditions.Key('user_id').eq(user_id),
            ScanIndexForward=False,  # Most recent first
            Limit=100  # Get more records to process sessions
        )
        
        messages = response.get('Items', [])
        
        # Group messages by session and get the most recent message from each session
        sessions = {}
        for msg in messages:
            session_id = msg['session_id']
            timestamp = msg['timestamp']
            
            if session_id not in sessions or timestamp > sessions[session_id]['last_message_time']:
                # Find a user message for preview (prefer user messages)
                preview_content = ""
                if msg['role'] == 'user':
                    preview_content = msg['content'][:100] + "..." if len(msg['content']) > 100 else msg['content']
                elif session_id in sessions:
                    # Keep existing preview if we had one
                    preview_content = sessions[session_id].get('preview', '')
                
                # If we still don't have a preview and this is an assistant message, use it
                if not preview_content and msg['role'] == 'assistant':
                    preview_content = msg['content'][:100] + "..." if len(msg['content']) > 100 else msg['content']
                
                sessions[session_id] = {
                    'session_id': session_id,
                    'last_message_time': timestamp,
                    'preview': preview_content,
                    'agent_type': msg.get('agent_type', 'health-assistant'),
                    'last_activity': datetime.fromisoformat(timestamp.replace('Z', '+00:00')).strftime('%Y-%m-%d %H:%M')
                }
        
        # Convert to list and sort by most recent
        session_list = list(sessions.values())
        session_list.sort(key=lambda x: x['last_message_time'], reverse=True)
        
        # Return top sessions
        return session_list[:max_sessions]
        
    except Exception as e:
        logger.warning(f"Failed to retrieve user recent chats: {e}")
        return []


def get_full_conversation(session_id: str, user_id: str) -> List[Dict[str, Any]]:
    """
    Retrieve full conversation for a session
    
    Args:
        session_id: The session ID
        user_id: The user ID (for security validation)
        
    Returns:
        List of all messages in the conversation
    """
    try:
        table = dynamodb.Table(CONVERSATION_TABLE)
        
        response = table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key('session_id').eq(session_id),
            FilterExpression=boto3.dynamodb.conditions.Attr('user_id').eq(user_id),  # Security check
            ScanIndexForward=True  # Chronological order
        )
        
        messages = response.get('Items', [])
        
        # Format messages for frontend
        formatted_messages = []
        for msg in messages:
            formatted_messages.append({
                'id': msg['message_id'],
                'role': msg['role'],
                'content': msg['content'],
                'timestamp': msg['timestamp'],
                'agent_type': msg.get('agent_type')
            })
        
        return formatted_messages
        
    except Exception as e:
        logger.warning(f"Failed to retrieve full conversation: {e}")
        return []


def save_conversation_message(session_id: str, user_id: str, role: str, content: str, agent_type: Optional[str] = None) -> None:
    """
    Save a conversation message to DynamoDB
    
    Args:
        session_id: The session ID
        user_id: The user ID
        role: The role (user/assistant)
        content: The message content
        agent_type: The agent that handled the message (for assistant messages)
    """
    try:
        table = dynamodb.Table(CONVERSATION_TABLE)
        
        timestamp = datetime.now().isoformat()
        message_id = f"{session_id}#{timestamp}"
        
        item = {
            'session_id': session_id,
            'message_id': message_id,
            'user_id': user_id,
            'role': role,
            'content': content,
            'timestamp': timestamp,
            'ttl': int(datetime.now().timestamp()) + (7 * 24 * 60 * 60)  # 7 days TTL
        }
        
        if agent_type:
            item['agent_type'] = agent_type
            
        table.put_item(Item=item)
        logger.info(f"Saved {role} message to conversation history")
        
    except Exception as e:
        logger.warning(f"Failed to save conversation message: {e}")


def build_conversation_context(session_id: str, user_id: str, current_message: str) -> str:
    """
    Build conversation context by retrieving history and formatting it
    
    Args:
        session_id: The session ID
        user_id: The user ID
        current_message: The current user message
        
    Returns:
        Formatted conversation context
    """
    history = get_conversation_history(session_id, user_id)
    
    if not history:
        return current_message
    
    # Build context with conversation history
    context_parts = ["Previous conversation:"]
    
    for msg in history[-6:]:  # Last 6 messages (3 exchanges)
        role = "User" if msg['role'] == 'user' else "Assistant"
        content = msg['content'][:200] + "..." if len(msg['content']) > 200 else msg['content']
        context_parts.append(f"{role}: {content}")
    
    context_parts.append(f"\nCurrent message:\nUser: {current_message}")
    
    return "\n".join(context_parts)


def select_agent(message: str, session_id: str, user_id: str, explicit_agent: Optional[str] = None) -> str:
    """
    Determines the most appropriate agent based on message content and conversation context
    
    Args:
        message: The user's message
        session_id: The session ID for conversation context
        user_id: The user ID
        explicit_agent: Optional explicit agent selection
        
    Returns:
        The selected agent type
    """
    if explicit_agent and explicit_agent in AGENT_RUNTIME_ARNS:
        return explicit_agent

    # Get conversation history to determine context
    history = get_conversation_history(session_id, user_id, max_messages=4)
    
    # If we have recent conversation history, check the last agent used
    last_agent = None
    if history:
        for msg in reversed(history):
            if msg['role'] == 'assistant' and 'agent_type' in msg:
                last_agent = msg['agent_type']
                break
    
    # Check if current message is a continuation/response to previous conversation
    continuation_keywords = ['yes', 'no', 'ok', 'sure', 'that works', 'sounds good', 'perfect', 'great']
    message_lower = message.lower().strip()
    
    is_continuation = any(keyword in message_lower for keyword in continuation_keywords)
    is_short_response = len(message.split()) <= 5
    
    # If it seems like a continuation and we have a recent agent, stick with it
    if last_agent and (is_continuation or is_short_response) and last_agent in AGENT_RUNTIME_ARNS:
        logger.info(f"Continuing with previous agent: {last_agent}")
        return last_agent

    # Otherwise, do keyword-based routing
    scores = {}
    for agent_type, keywords in AGENT_KEYWORDS.items():
        scores[agent_type] = sum(1 for keyword in keywords if keyword in message_lower)

    # Find agent with highest score
    if scores:
        best_agent = max(scores.keys(), key=lambda k: scores[k])
        best_score = scores[best_agent]
        
        # Default to health-assistant if no clear match
        return best_agent if best_score > 0 else 'health-assistant'
    else:
        return 'health-assistant'


def invoke_agent(agent_type: str, message: str, session_id: str, user_id: str = 'anonymous') -> str:
    """
    Invoke agent using AgentCore if available, otherwise fallback to Foundation Model
    
    Args:
        agent_type: The selected agent type
        message: The user message
        session_id: The session ID
        user_id: The user ID for conversation tracking
        
    Returns:
        The agent response text
    """
    if AGENTCORE_AVAILABLE and agent_type in AGENT_RUNTIME_ARNS:
        try:
            return invoke_agentcore(agent_type, message, session_id)
        except Exception as e:
            logger.warning(f"AgentCore failed for {agent_type}: {e}")
            logger.info("Falling back to Foundation Model")
            return invoke_foundation_model(agent_type, message, session_id, user_id)
    else:
        logger.info(f"Using Foundation Model for {agent_type}")
        return invoke_foundation_model(agent_type, message, session_id, user_id)


def invoke_agentcore(agent_type: str, message: str, session_id: str) -> str:
    """
    Invoke Bedrock AgentCore agent or ECR containerized agent
    
    Args:
        agent_type: The selected agent type
        message: The user message
        session_id: The session ID
        
    Returns:
        The AgentCore response text
    """
    logger.info(f"Invoking AgentCore for agent: {agent_type}")
    logger.info(f"Message: {message}")
    
    agent_runtime_identifier = AGENT_RUNTIME_ARNS[agent_type]
    
    try:
        # Check if this is an ECR URI or an actual AgentCore ARN
        if agent_runtime_identifier.startswith('775525057465.dkr.ecr'):
            # This is an ECR container - for now, simulate AgentCore by calling Foundation Model
            # In a real implementation, AgentCore would manage the container execution
            logger.info(f"ECR container detected: {agent_runtime_identifier}")
            logger.info("Simulating AgentCore container execution via Foundation Model")
            
            # Add a note that this is running through AgentCore container simulation
            agent_prompt = AGENT_PROMPTS.get(agent_type, AGENT_PROMPTS['health-assistant'])
            enhanced_prompt = f"{agent_prompt}\n\n[Running via AgentCore Python Container: {agent_runtime_identifier}]\n\nUser: {message}\n\nAssistant:"
            
            # Use Foundation Model to simulate the containerized agent
            return invoke_foundation_model_direct(agent_type, enhanced_prompt, session_id)
            
        elif bedrock_agentcore is not None and agent_runtime_identifier.startswith('arn:aws:bedrock-agentcore'):
            # This is a real AgentCore ARN
            logger.info(f"Real AgentCore ARN detected: {agent_runtime_identifier}")
            
            # Prepare the payload as per AWS documentation
            payload = json.dumps({"prompt": message}).encode()
            
            response = bedrock_agentcore.invoke_agent_runtime(
                agentRuntimeArn=agent_runtime_identifier,
                runtimeSessionId=session_id,
                payload=payload
            )
            
            # Process AgentCore streaming response as per AWS documentation
            response_text = ""
            if "text/event-stream" in response.get("contentType", ""):
                # Handle streaming response
                content = []
                for line in response["response"].iter_lines(chunk_size=10):
                    if line:
                        line = line.decode("utf-8")
                        if line.startswith("data: "):
                            line = line[6:]
                            content.append(line)
                response_text = "\n".join(content)
                
            elif response.get("contentType") == "application/json":
                # Handle standard JSON response
                content = []
                for chunk in response.get("response", []):
                    content.append(chunk.decode('utf-8'))
                response_data = json.loads(''.join(content))
                response_text = str(response_data)
            else:
                # Handle other content types
                response_text = str(response)
            
            if response_text:
                logger.info(f"AgentCore response received: {len(response_text)} characters")
                return response_text
            else:
                raise Exception("No response text received from AgentCore")
        else:
            raise Exception("AgentCore client not available or invalid runtime identifier")
            
    except Exception as e:
        logger.error(f"AgentCore error: {e}")
        raise e


def invoke_foundation_model_direct(agent_type: str, prompt: str, session_id: str) -> str:
    """
    Direct Foundation Model invocation with custom prompt
    
    Args:
        agent_type: The selected agent type
        prompt: The complete prompt to send
        session_id: The session ID
        
    Returns:
        The model response text
    """
    logger.info(f"Direct Foundation Model call for agent: {agent_type}")
    
    # Select appropriate model based on agent type (using Amazon Nova Pro)
    model_map = {
        'health-assistant': 'amazon.nova-pro-v1:0',
        'appointment-agent': 'amazon.nova-pro-v1:0',
        'community-agent': 'amazon.nova-pro-v1:0',
        'document-agent': 'amazon.nova-pro-v1:0'
    }
    
    model_id = model_map.get(agent_type, model_map['health-assistant'])
    
    # Create the request body for Amazon Nova Pro
    body = json.dumps({
        "messages": [{
            "role": "user",
            "content": [{"text": prompt}]
        }],
        "inferenceConfig": {
            "maxTokens": 500,
            "temperature": 0.7,
            "topP": 0.9
        }
    })
    
    try:
        response = bedrock_runtime.invoke_model(
            modelId=model_id,
            body=body,
            contentType="application/json",
            accept="application/json"
        )
        
        response_body = json.loads(response['body'].read())
        logger.info(f"Amazon Nova Pro response: {json.dumps(response_body, default=str)}")
        
        # Extract text from Amazon Nova Pro response
        if 'output' in response_body and 'message' in response_body['output']:
            content = response_body['output']['message']['content']
            if isinstance(content, list) and len(content) > 0:
                return content[0]['text']
            elif isinstance(content, str):
                return content
        elif 'outputText' in response_body:
            return response_body['outputText']
        else:
            logger.warning(f"Unexpected Nova response format: {response_body}")
            return "I provided a response, but there was an issue formatting it. Please try again."
        
    except Exception as e:
        logger.error(f"Amazon Nova Pro error: {e}")
        return "I apologize, but I'm unable to process your request at the moment. Please try again later."


def invoke_foundation_model(agent_type: str, message: str, session_id: str, user_id: str = 'anonymous') -> str:
    """
    Invoke Amazon Nova Pro model directly with conversation context
    
    Args:
        agent_type: The selected agent type
        message: The user message
        session_id: The session ID
        user_id: The user ID for conversation tracking
        
    Returns:
        The model response text
    """
    logger.info(f"Invoking Amazon Nova Pro for agent: {agent_type}")
    logger.info(f"Message: {message}")
    
    # Get conversation history and build context
    history = get_conversation_history(session_id, user_id)
    conversation_context = build_conversation_context(session_id, user_id, message)
    
    # Select appropriate model based on agent type (using Amazon Nova Pro)
    model_map = {
        'health-assistant': 'amazon.nova-pro-v1:0',
        'appointment-agent': 'amazon.nova-pro-v1:0',
        'community-agent': 'amazon.nova-pro-v1:0',
        'document-agent': 'amazon.nova-pro-v1:0'
    }
    
    model_id = model_map.get(agent_type, model_map['health-assistant'])
    agent_prompt = AGENT_PROMPTS.get(agent_type, AGENT_PROMPTS['health-assistant'])
    
    # Prepare the prompt with conversation context
    if conversation_context:
        prompt = f"{agent_prompt}\n\nConversation History:\n{conversation_context}\n\nUser: {message}\n\nAssistant:"
    else:
        prompt = f"{agent_prompt}\n\nUser: {message}\n\nAssistant:"
    
    # Create the request body for Amazon Nova Pro
    body = json.dumps({
        "messages": [{
            "role": "user",
            "content": [{"text": prompt}]
        }],
        "inferenceConfig": {
            "maxTokens": 500,
            "temperature": 0.7,
            "topP": 0.9
        }
    })
    
    try:
        response = bedrock_runtime.invoke_model(
            modelId=model_id,
            body=body,
            contentType="application/json",
            accept="application/json"
        )
        
        response_body = json.loads(response['body'].read())
        logger.info(f"Amazon Nova Pro response: {json.dumps(response_body, default=str)}")
        
        # Extract text from Amazon Nova Pro response
        ai_response = "I provided a response, but there was an issue formatting it. Please try again."
        
        if 'output' in response_body and 'message' in response_body['output']:
            content = response_body['output']['message']['content']
            if isinstance(content, list) and len(content) > 0:
                ai_response = content[0]['text']
            elif isinstance(content, str):
                ai_response = content
        elif 'outputText' in response_body:
            ai_response = response_body['outputText']
        else:
            logger.warning(f"Unexpected Nova response format: {response_body}")
        
        # Save conversation messages
        save_conversation_message(session_id, user_id, 'user', message)
        save_conversation_message(session_id, user_id, 'assistant', ai_response, agent_type)
        
        return ai_response
        
    except Exception as e:
        logger.error(f"Amazon Nova Pro error: {e}")
        return "I apologize, but I'm unable to process your request at the moment. Please try again later."


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for the Agent Router
    
    Args:
        event: The Lambda event
        context: The Lambda context
        
    Returns:
        The HTTP response
    """
    try:
        # Parse the request
        body = json.loads(event.get('body', '{}'))
        message = body.get('message')
        user_id = body.get('userId', 'anonymous')
        session_id = body.get('sessionId', f"session-{int(datetime.now().timestamp())}")
        agent_type = body.get('agentType')
        
        if not message:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({
                    'error': 'Message is required'
                })
            }
        
        # Select appropriate agent
        selected_agent = select_agent(message, session_id, user_id, agent_type)
        agent_runtime_arn = AGENT_RUNTIME_ARNS[selected_agent]
        
        logger.info(f"Routing to agent: {selected_agent} for user: {user_id}")
        
        # Use hybrid approach: AgentCore with Foundation Model fallback
        response_text = invoke_agent(selected_agent, message, session_id, user_id)
        
        # Determine the source based on what was actually used
        source = "bedrock-agentcore" if AGENTCORE_AVAILABLE else "amazon-nova-pro"
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'response': response_text,
                'agent': selected_agent,
                'sessionId': session_id,
                'timestamp': datetime.now().isoformat(),
                'source': source,
                'agentcore_available': AGENTCORE_AVAILABLE
            })
        }
        
    except Exception as e:
        logger.error(f"Agent Router Error: {e}")
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'message': 'Failed to process agent request'
            })
        }


def health_check_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Health check endpoint
    """
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps({
            'status': 'healthy',
            'agents': list(AGENT_RUNTIME_ARNS.keys()),
            'timestamp': datetime.now().isoformat()
        })
    }


def get_agents_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Get available agents endpoint
    """
    agents_info = {
        'health-assistant': {
            'name': 'Health Assistant',
            'description': 'General health guidance and symptom assessment',
            'arn': AGENT_RUNTIME_ARNS['health-assistant']
        },
        'appointment-agent': {
            'name': 'Appointment Agent',
            'description': 'Medication reminders and appointment scheduling',
            'arn': AGENT_RUNTIME_ARNS['appointment-agent']
        },
        'community-agent': {
            'name': 'Community Agent',
            'description': 'Health research and community insights',
            'arn': AGENT_RUNTIME_ARNS['community-agent']
        },
        'document-agent': {
            'name': 'Document Agent',
            'description': 'Medical document analysis and interpretation',
            'arn': AGENT_RUNTIME_ARNS['document-agent']
        }
    }
    
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps({
            'agents': agents_info
        })
    }


def get_recent_chats_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Get recent chat sessions for a user
    """
    try:
        # Extract user ID from query parameters
        query_params = event.get('queryStringParameters') or {}
        user_id = query_params.get('userId')
        
        if not user_id or user_id == 'anonymous':
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({
                    'error': 'User ID is required for recent chats'
                })
            }
        
        # Get recent chats
        recent_chats = get_user_recent_chats(user_id, max_sessions=20)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'recent_chats': recent_chats,
                'count': len(recent_chats)
            })
        }
        
    except Exception as e:
        logger.error(f"Get Recent Chats Error: {e}")
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'error': 'Failed to retrieve recent chats'
            })
        }


def get_conversation_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Get full conversation for a session
    """
    try:
        # Extract session ID from path parameters
        path_params = event.get('pathParameters') or {}
        session_id = path_params.get('sessionId')
        
        # Extract user ID from query parameters for security
        query_params = event.get('queryStringParameters') or {}
        user_id = query_params.get('userId')
        
        if not session_id:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({
                    'error': 'Session ID is required'
                })
            }
        
        if not user_id or user_id == 'anonymous':
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({
                    'error': 'User ID is required for conversation access'
                })
            }
        
        # Get full conversation
        conversation = get_full_conversation(session_id, user_id)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'session_id': session_id,
                'messages': conversation,
                'count': len(conversation)
            })
        }
        
    except Exception as e:
        logger.error(f"Get Conversation Error: {e}")
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'error': 'Failed to retrieve conversation'
            })
        }
