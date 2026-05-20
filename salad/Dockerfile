# Talking Head — EchoMimic V2 em SaladCloud
# Build: docker build -t SEU_USUARIO/talkinghead:latest .
# Push:  docker push SEU_USUARIO/talkinghead:latest

FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PORT=3000
ENV MODEL_DIR=/app/models
ENV PYTHONUNBUFFERED=1

# Sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clona EchoMimic V2
RUN git clone https://github.com/antgroup/echomimic_v2.git /app/EchoMimicV2 \
    && cd /app/EchoMimicV2 \
    && pip install --no-cache-dir -r requirements.txt

# Dependências do servidor
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copia servidor
COPY server.py /app/server.py

# Diretório de modelos (volume persistente no SaladCloud)
RUN mkdir -p /app/models

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=5 \
    CMD curl -sf http://localhost:${PORT}/health || exit 1

EXPOSE ${PORT}

CMD ["python", "/app/server.py"]
