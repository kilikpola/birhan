FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package.json .
RUN npm install

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && npm run dev"]
