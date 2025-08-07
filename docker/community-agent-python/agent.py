"""
Enabl Community Agent (Python)

Handles community content curation, health discussions, and resource sharing.
Finds and curates relevant internet resources, articles, and content.

Built for AWS Bedrock AgentCore compatibility with Python runtime.
"""

import json
import logging
import boto3
from typing import Dict, Any, Optional, List
from datetime import datetime

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize Bedrock clients
bedrock_runtime = boto3.client('bedrock-runtime', region_name='us-east-1')

def analyze_community_intent(message: str) -> Dict[str, Any]:
    """
    Analyze the user's message to determine community intent
    
    Args:
        message: User's community-related message
        
    Returns:
        Dictionary with intent analysis
    """
    message_lower = message.lower()
    
    # Define community intent categories
    intents = {
        'content_search': ['find', 'search', 'looking for', 'need', 'where can i'],
        'share': ['share', 'post', 'tell others', 'recommend'],
        'discussion': ['discuss', 'talk about', 'opinions', 'thoughts'],
        'support': ['support', 'help', 'advice', 'guidance'],
        'resources': ['resources', 'articles', 'studies', 'research'],
        'community': ['community', 'group', 'forum', 'connect'],
        'wellness': ['wellness', 'health tips', 'lifestyle', 'prevention']
    }
    
    # Content type categories
    content_types = {
        'articles': ['article', 'blog', 'news', 'report'],
        'research': ['study', 'research', 'clinical trial', 'publication'],
        'videos': ['video', 'tutorial', 'webinar', 'presentation'],
        'podcasts': ['podcast', 'audio', 'interview'],
        'tools': ['tool', 'app', 'calculator', 'tracker'],
        'forums': ['forum', 'discussion', 'community', 'group']
    }
    
    # Health topic categories
    health_topics = {
        'nutrition': ['nutrition', 'diet', 'food', 'eating', 'vitamins'],
        'fitness': ['exercise', 'workout', 'fitness', 'activity', 'gym'],
        'mental_health': ['mental health', 'stress', 'anxiety', 'depression'],
        'chronic_conditions': ['diabetes', 'hypertension', 'arthritis', 'heart'],
        'preventive_care': ['screening', 'prevention', 'checkup', 'vaccine'],
        'women_health': ['women', 'pregnancy', 'menopause', 'reproductive'],
        'men_health': ['men', 'prostate', 'testosterone'],
        'senior_health': ['senior', 'elderly', 'aging', 'geriatric']
    }
    
    detected_intents = []
    for intent, keywords in intents.items():
        if any(keyword in message_lower for keyword in keywords):
            detected_intents.append(intent)
    
    detected_content_types = []
    for content_type, keywords in content_types.items():
        if any(keyword in message_lower for keyword in keywords):
            detected_content_types.append(content_type)
    
    detected_topics = []
    for topic, keywords in health_topics.items():
        if any(keyword in message_lower for keyword in keywords):
            detected_topics.append(topic)
    
    return {
        'primary_intent': detected_intents[0] if detected_intents else 'content_search',
        'all_intents': detected_intents,
        'content_types': detected_content_types,
        'health_topics': detected_topics,
        'needs_curation': any(intent in detected_intents for intent in ['content_search', 'resources']),
        'is_sharing': 'share' in detected_intents
    }

def get_community_response(message: str, intent_analysis: Dict[str, Any], user_context: Optional[Dict] = None) -> str:
    """
    Generate community agent response using Bedrock
    
    Args:
        message: User's message
        intent_analysis: Analysis of the community intent
        user_context: Optional user context
        
    Returns:
        Community agent response
    """
    # Build system prompt based on intent
    system_prompt = """You are the Enabl Community Agent, specialized in health and wellness content curation and community engagement.

Your capabilities:
- Find and curate relevant health and wellness content from the internet
- Recommend articles, research papers, and educational resources
- Connect users with health communities and support groups
- Facilitate health discussions and knowledge sharing
- Provide latest health news and research updates
- Help users find credible health information sources

Content curation expertise:
- Medical journals and research publications
- Health news from reputable sources
- Wellness blogs and lifestyle content
- Patient community forums and support groups
- Health tools and mobile applications
- Educational videos and webinars

Community features:
- Health discussion topics and trends
- Patient support networks
- Wellness challenges and programs
- Expert Q&A sessions
- Health advocacy and awareness campaigns

Content quality standards:
- Prioritize evidence-based information
- Recommend peer-reviewed sources when possible
- Verify credibility of health websites and resources
- Provide balanced perspectives on health topics
- Include disclaimers for medical information

Guidelines:
- Always recommend consulting healthcare professionals for medical decisions
- Curate content from reputable health organizations and medical institutions
- Encourage community support while maintaining privacy
- Promote inclusive and supportive health discussions
- Update recommendations with latest research and guidelines"""

    # Add intent-specific guidance
    if intent_analysis['needs_curation']:
        system_prompt += "\n\nIMPORTANT: This request needs content curation. Focus on finding and recommending relevant, credible health resources."
    
    if intent_analysis['is_sharing']:
        system_prompt += "\n\nNote: The user wants to share content with the community. Provide guidance on effective sharing and community engagement."

    # Prepare the prompt for Amazon Nova Pro
    prompt = f"{system_prompt}\n\nUser Request: {message}\n\nCommunity Agent Response:"
    
    # Create the request body
    body = json.dumps({
        "messages": [{
            "role": "user",
            "content": [{"text": prompt}]
        }],
        "inferenceConfig": {
            "maxTokens": 800,
            "temperature": 0.7,
            "topP": 0.9
        }
    })

    try:
        response = bedrock_runtime.invoke_model(
            modelId='amazon.nova-pro-v1:0',
            body=body,
            contentType="application/json",
            accept="application/json"
        )
        
        response_body = json.loads(response['body'].read())
        logger.info(f"Community Agent Nova response received")
        
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
            return "I'm here to help you find health and wellness content. Could you please specify what type of information you're looking for?"
        
    except Exception as e:
        logger.error(f"Community Agent Nova error: {e}")
        return "I apologize, but I'm unable to process your community request at the moment. Please try again or check our health resource library."

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for Community Agent
    
    Args:
        event: Lambda event containing the community request
        context: Lambda context
        
    Returns:
        Community agent response
    """
    try:
        # Parse the incoming request
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        message = body.get('message', '')
        user_id = body.get('userId', 'anonymous')
        session_id = body.get('sessionId', f"session-{int(datetime.now().timestamp())}")
        user_context = body.get('context', {})
        
        logger.info(f"Community Agent request - User: {user_id}, Session: {session_id}, Message length: {len(message)}")
        
        if not message:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({
                    'error': 'Message is required',
                    'agent': 'community-agent'
                })
            }
        
        # Analyze the community intent
        intent_analysis = analyze_community_intent(message)
        logger.info(f"Community intent analysis: {intent_analysis}")
        
        # Generate response
        response_text = get_community_response(message, intent_analysis, user_context)
        
        # Prepare the response
        response_data = {
            'response': response_text,
            'agent': 'community-agent',
            'sessionId': session_id,
            'timestamp': datetime.now().isoformat(),
            'intent_analysis': intent_analysis,
            'source': 'enabl-community-agent-python'
        }
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps(response_data)
        }
        
    except Exception as e:
        logger.error(f"Community Agent error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'agent': 'community-agent',
                'timestamp': datetime.now().isoformat()
            })
        }
