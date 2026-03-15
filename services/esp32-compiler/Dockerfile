FROM ghcr.io/diaskabdualiev/code-studio-esp32-test/esp32-base:latest

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY index.js ./

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV ARDUINO_CLI_PATH=/app/arduino-cli/arduino-cli
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "index.js"]
