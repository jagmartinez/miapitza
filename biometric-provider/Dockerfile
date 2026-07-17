FROM python:3.12-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FACE_MODELS_DIR=/app/models

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system face \
    && adduser --system --ingroup face --home /app face

COPY requirements.txt ./requirements.txt
RUN pip install --requirement requirements.txt

COPY scripts ./scripts
RUN python scripts/fetch_models.py --destination /app/models

COPY app ./app
RUN mkdir -p /app/data && chown -R face:face /app

USER face
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','8080')+'/health', timeout=3)"

CMD ["python", "-m", "app"]

FROM runtime AS test
USER root
COPY requirements-dev.txt ./requirements-dev.txt
RUN pip install --requirement requirements-dev.txt
COPY tests ./tests
USER face
CMD ["python", "-m", "pytest", "--cov=app", "--cov-branch", "--cov-report=term-missing"]

FROM runtime AS final
