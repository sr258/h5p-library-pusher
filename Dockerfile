FROM node:10-alpine

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN chmod +x ./run.sh
EXPOSE 80
CMD [ "sh", "./run.sh" ]