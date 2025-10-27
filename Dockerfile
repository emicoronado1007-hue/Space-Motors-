FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY . .
ENV PORT=3000 DATA_DIR=/data UPLOADS_DIR=/data/uploads
RUN mkdir -p /data/uploads
EXPOSE 3000
CMD ["npm","start"]
