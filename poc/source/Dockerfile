FROM node:24-slim

# Build the lib in /workspace so file:../.. resolves from /workspace/poc/source
# (the package.json file: dep is relative to the package.json location).
WORKDIR /workspace
COPY package.json tsconfig.json eslint.config.mjs ./
COPY src ./src
RUN npm install --no-audit --no-fund \
 && npm run build

# POC source.
WORKDIR /workspace/poc/source
COPY poc/source/package.json poc/source/tsconfig.json ./
COPY poc/source/src ./src
RUN npm install --no-audit --no-fund

CMD ["npm", "start"]
