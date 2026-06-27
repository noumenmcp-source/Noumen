FROM python:3.11

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ml_content_worker ./src/ml_content_worker
CMD ["python", "-m", "ml_content_worker.__main__"]