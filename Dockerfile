FROM mcr.microsoft.com/playwright:v1.55.0-noble AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["npm","start"]
