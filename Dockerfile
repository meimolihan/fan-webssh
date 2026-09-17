FROM node:22.16-alpine3.20 AS builder_web
WORKDIR /fan-webssh/web
COPY web/package.json ./
COPY yarn.lock ./
RUN yarn install
COPY ./web .
RUN yarn build

FROM node:22.16-alpine3.20 AS builder_server
WORKDIR /fan-webssh/server
COPY server/package.json ./
COPY yarn.lock ./
RUN yarn install --production=true
COPY --from=builder_web /fan-webssh/web/dist ./app/static
COPY ./server .

FROM node:22.16-alpine3.20
RUN apk add --no-cache iputils
WORKDIR /fan-webssh
COPY --from=builder_server /fan-webssh/server .
RUN chmod +x /fan-webssh/bin/fan-webssh.js \
    && ln -sf /fan-webssh/bin/fan-webssh.js /usr/local/bin/fan-webssh \
    && rm -rf test scripts dev-local.js .env.template eslint.config.cjs jsconfig.json README.md
ENV HOST=0.0.0.0
EXPOSE 8082
CMD ["npm", "start"]