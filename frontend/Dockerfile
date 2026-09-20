# ---- dev: Vite dev server with HMR (used by docker-compose.yml) ----
FROM node:24-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---- build: produce the static dist/ bundle ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Optional: your own product name in the app (the default is in brand.json).
ARG VITE_APP_NAME=""
ENV VITE_APP_NAME=$VITE_APP_NAME
RUN npm run build

# ---- prod: nginx serving the built SPA (nginx.conf mounted via compose) ----
FROM nginx:1.30-alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
