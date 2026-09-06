# SOURCE: python:3.13-slim; psycopg[binary] ships libpq, so no compiler is needed.
FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY ingest/requirements.txt ./ingest/requirements.txt
RUN pip install --no-cache-dir -r ingest/requirements.txt
COPY ingest ./ingest
RUN python -m unittest discover -s ingest/tests -t . \
 && useradd --create-home --uid 10001 ingester
USER ingester
# Arguments are supplied by the compose command, for example --every 300.
ENTRYPOINT ["python", "-m", "ingest.ingest"]
