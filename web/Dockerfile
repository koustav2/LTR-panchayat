# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
# Playwright is a devDependency (test tooling). Its postinstall would pull
# ~500 MB of browsers into an image that only needs to run `vite build`.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- serve ----
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
