# The container a team copies: Node, the package, nothing else.
#
# Two stages so the runtime image carries no TypeScript, no test runner and no
# devDependencies. The stub has no database, no Redis and no credentials, which is
# why it starts in about a second and is safe to run in CI.

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
# `--ignore-scripts` skips the `prepare` build, which would run before src/ is copied.
# The build is an explicit step below, where both the source and the compiler exist.
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    STUB_PORT=4010

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# A stub holds nothing worth stealing, but running as root is a habit worth not
# forming in an image other teams will copy.
USER node

EXPOSE 4010

# The same `/health` the package serves, so a compose `depends_on` and a test's
# "is the stub up" wait agree on what up means.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.STUB_PORT||4010)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/bin.js"]
