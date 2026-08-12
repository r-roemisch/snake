FROM python:3.11-slim

# Prevent Python from writing pyc files and buffering stdout
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install Pygame system dependencies for headless execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    freeglut3-dev \
    && rm -rf /var/lib/apt/lists/*

ENV SDL_VIDEODRIVER=dummy

WORKDIR /workspace

# Install game and testing packages inside the container
RUN pip install --no-cache-dir pygame pytest

# Default command runs headless execution
CMD ["python", "-m", "pytest"]