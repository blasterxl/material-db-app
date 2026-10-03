FROM node:18-slim

# Встановлюємо Python3, pip та системні залежності
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt-get/lists/*

WORKDIR /app

# Встановлюємо Python-бібліотеки
RUN pip3 install reportlab Pillow --break-system-packages

# Копіюємо всі файли проекту в контейнер
COPY . .

EXPOSE 4177

CMD ["node", "server.js"]