# Use AWS Lambda Python runtime as base for ARM64 (required by Bedrock AgentCore)
FROM public.ecr.aws/lambda/python:3.11-arm64

# Copy function code
COPY . ${LAMBDA_TASK_ROOT}/

# Install dependencies
RUN pip install -r requirements.txt

# Set the CMD to your handler
CMD ["agent.handler"]
