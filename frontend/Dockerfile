# Vite 7 要求 Node ^20.19.0 || >=22.12.0，这里固定 22 系列
FROM node:22-alpine
WORKDIR /srv/web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
