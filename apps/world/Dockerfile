FROM node:22-alpine
WORKDIR /app
COPY npc-factory ./npc-factory
COPY src ./src
COPY data ./data
CMD ["node", "npc-factory/npc-ai-cloud-run.mjs"]
