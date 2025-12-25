FROM python:3.10-slim

# System-Dependencies für Audio-Verarbeitung
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python-Dependencies installieren
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App-Code kopieren
COPY app.py .

# Port exposieren
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:5000/health')"

# App starten
CMD ["python", "app.py"]
