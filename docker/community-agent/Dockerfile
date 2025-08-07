# Use AWS Lambda Node.js runtime as base for ARM64 (required by Bedrock AgentCore)
FROM public.ecr.aws/lambda/nodejs:18-arm64

# Copy function code
COPY . ${LAMBDA_TASK_ROOT}/

# Install dependencies
RUN npm install

# Set the CMD to your handler
CMD ["index.handler"]
