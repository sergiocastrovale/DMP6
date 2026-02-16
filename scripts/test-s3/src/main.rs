use aws_config::BehaviorVersion;
use aws_sdk_s3::Client as S3Client;

#[tokio::main]
async fn main() {
    dotenvy::from_path("../../web/.env").ok();

    let bucket = std::env::var("S3_BUCKET").expect("S3_BUCKET not set");
    let region = std::env::var("S3_REGION").expect("S3_REGION not set");
    let access_key = std::env::var("S3_ACCESS_KEY_ID").expect("S3_ACCESS_KEY_ID not set");
    let secret_key = std::env::var("S3_SECRET_ACCESS_KEY").expect("S3_SECRET_ACCESS_KEY not set");

    println!("Testing S3 connection...");
    println!("Bucket: {}", bucket);
    println!("Region: {}", region);
    println!();

    let mut aws_config = aws_config::defaults(BehaviorVersion::latest());
    aws_config = aws_config.region(aws_sdk_s3::config::Region::new(region.clone()));
    aws_config = aws_config.credentials_provider(
        aws_sdk_s3::config::Credentials::new(
            access_key,
            secret_key,
            None,
            None,
            "test"
        )
    );
    
    let aws_config = aws_config.load().await;
    let s3_client = S3Client::new(&aws_config);

    // Test 1: List bucket
    println!("Test 1: Listing bucket...");
    match s3_client.list_objects_v2().bucket(&bucket).max_keys(1).send().await {
        Ok(_) => println!("✓ Bucket access OK"),
        Err(e) => {
            println!("✗ Failed: {:?}", e);
            println!("Error: {}", e);
            if let Some(service_err) = e.as_service_error() {
                println!("Service error: {:?}", service_err);
            }
        }
    }

    // Test 2: Upload a test file
    println!();
    println!("Test 2: Uploading test file...");
    
    let test_content = b"test";
    match s3_client
        .put_object()
        .bucket(&bucket)
        .key("test/test.txt")
        .body(test_content.to_vec().into())
        .content_type("text/plain")
        .send()
        .await
    {
        Ok(_) => println!("✓ Upload OK"),
        Err(e) => {
            println!("✗ Upload failed:");
            println!("Error type: {:?}", e);
            println!("Error message: {}", e);
            if let Some(service_err) = e.as_service_error() {
                println!("Service error details: {:?}", service_err);
            }
        }
    }
}
