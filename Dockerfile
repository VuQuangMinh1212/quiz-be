FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Run migrations then start server
CMD ["sh", "-c", "npm run migrate && npm run start"]
