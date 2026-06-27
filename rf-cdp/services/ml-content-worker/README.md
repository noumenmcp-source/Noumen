# ml-content-worker

A Python service to generate personalized email content for marketing campaigns.

## Usage

Run the worker with:

```bash
python -m ml_content_worker run --campaign-id <campaign_id> --segment-id <segment_id> --variants <number_of_variants>
```

Ensure the necessary environment variables are set in `.env`.

## Dependencies

Install dependencies using:

```bash
pip install -r requirements.txt
```

## Docker

Build and run the Docker container:

```bash
docker build -t ml-content-worker .
docker run --env-file .env ml-content-worker