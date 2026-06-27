import os

class Config:
    DITTOFEED_API = os.getenv('DITTOFEED_API')
    DITTOFEED_ADMIN_KEY = os.getenv('DITTOFEED_ADMIN_KEY')
    FLOT_BASE_URL = os.getenv('FLOT_BASE_URL', 'http://127.0.0.1:3264/api/v1')
    FLOT_MODEL = os.getenv('FLOT_MODEL', 'qwen3.7-max')
    MAX_MICROSEGMENTS = int(os.getenv('MAX_MICROSEGMENTS', 5))
    VARIANTS_PER_SEGMENT = int(os.getenv('VARIANTS_PER_SEGMENT', 3))