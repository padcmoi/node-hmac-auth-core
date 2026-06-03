FROM node:24-slim

WORKDIR /workspace
COPY package.json tsconfig.json eslint.config.mjs ./
COPY src ./src
RUN npm install --no-audit --no-fund \
 && npm run build

WORKDIR /workspace/poc/target
COPY poc/target/package.json poc/target/tsconfig.json ./
COPY poc/target/src ./src
RUN npm install --no-audit --no-fund

EXPOSE 3000

CMD ["npm", "start"]
