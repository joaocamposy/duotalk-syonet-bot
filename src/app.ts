import fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';
import rateLimit from '@fastify/rate-limit';
import { leadRoutes } from './routes/lead-routes.js';
import { queueInstance } from './queue/queue-manager.js';
import { processLeadJob } from './crawler/syonet-crawler.js';
import { scheduleLogPurge } from './utils/log-purger.js';
import { logger } from './utils/logger.js';
import { env } from './config/env.js';

export function buildApp() {
  const app = fastify({
    logger: false, // Usamos o logger pino customizado em src/utils/logger.ts
  });

  // Plugins
  app.register(cors, { origin: '*' });

  app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW,
    errorResponseBuilder: () => {
      return {
        success: false,
        message: `Limite de requisições excedido (${env.RATE_LIMIT_MAX} req/${env.RATE_LIMIT_TIME_WINDOW}). Tente novamente em breve.`,
      };
    },
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: 'Duotalk Syonet Bot API',
        description: 'API Webhook de integração do Duotalk ao Syonet CRM via crawler Playwright',
        version: '1.0.0',
      },
    },
  });

  app.register(swaggerUi, {
    routePrefix: '/',
  });

  // Registra as rotas HTTP
  app.register(leadRoutes);

  // Tratamento Global de Erros Zod
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      logger.warn({ issues: error.issues }, 'Erro de validação Zod no payload');
      return reply.status(400).send({
        success: false,
        message: 'Payload inválido',
        errors: error.format(),
      });
    }

    logger.error({ error: error.message, stack: error.stack }, 'Erro interno não tratado');
    return reply.status(500).send({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message,
    });
  });

  // Conectar o worker da fila ao crawler Syonet
  queueInstance.process(async (job) => {
    await processLeadJob(job);
  });

  // Iniciar agendamento do auto-purge de logs antigos
  scheduleLogPurge();

  return app;
}
