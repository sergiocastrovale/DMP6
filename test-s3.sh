#!/usr/bin/env bash

echo "Testing S3 Configuration..."
echo ""

# Load .env
export $(cat web/.env | grep -v '^#' | xargs)

echo "Bucket: $S3_BUCKET"
echo "Region: $S3_REGION"
echo "Access Key: ${S3_ACCESS_KEY_ID:0:10}..."
echo ""

# Test with AWS CLI if available
if command -v aws &> /dev/null; then
    echo "Testing with AWS CLI..."
    AWS_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID \
    AWS_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY \
    AWS_DEFAULT_REGION=$S3_REGION \
    aws s3 ls s3://$S3_BUCKET/ 2>&1
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "✓ S3 access works!"
    else
        echo ""
        echo "✗ S3 access failed. Check the error above."
    fi
else
    echo "AWS CLI not installed. Install with: pip install awscli"
    echo "Then run: aws configure"
fi
