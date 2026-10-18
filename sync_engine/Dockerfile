FROM python:3.11-slim-bookworm

LABEL maintainer="DevOps Infrastructure Team"
LABEL description="CephSync Enterprise - High-Throughput S3 & Ceph RGW Sync Engine"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY sync_engine/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY sync_engine/sync_engine.py /app/sync_engine.py

# Create unprivileged runner user
RUN useradd -u 10001 -m -s /bin/bash cephsync \
    && chown -R cephsync:cephsync /app

USER cephsync

ENTRYPOINT ["python3", "/app/sync_engine.py"]
CMD ["--help"]
