FROM node:18-slim

# Встановлюємо Python3, pip та пакети системних TrueType-шрифтів
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    fonts-freefont-ttf \
    fonts-dejavu-core \
    fontconfig \
    && rm -rf /var/lib/apt-get/lists/*

WORKDIR /app

RUN pip3 install reportlab Pillow --break-system-packages

COPY . .

EXPOSE 4177

CMD ["node", "server.js"]