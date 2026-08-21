import fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';
import rateLimit from '@fastify/rate-limit';
import { leadRoutes } from './routes/lead-routes.js';
import { queueInstance } from './queue/queue-manager.js';
import { processLeadJob } from './integrations/syonet/lead-processor.js';
import { logger } from './utils/logger.js';
import { env } from './config/env.js';
import { QueueCapacityError } from './queue/job-errors.js';
import { isAuthorizedConsumer } from './auth/api-auth.js';

interface BuildAppOptions {
  exposeDocumentation?: boolean;
  rateLimitMax?: number;
  startWorker?: boolean;
}

interface FastifyValidationErrorLike {
  validation: Array<{
    instancePath?: string;
    message?: string;
    params?: { missingProperty?: unknown };
  }>;
}

function hasFastifyValidation(error: unknown): error is FastifyValidationErrorLike {
  if (!error || typeof error !== 'object') return false;
  return Array.isArray((error as { validation?: unknown }).validation);
}

function getClientErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    ? statusCode
    : null;
}

export function buildApp(options: BuildAppOptions = {}) {
  const rateLimitMax = options.rateLimitMax ?? env.RATE_LIMIT_MAX;
  const exposeDocumentation = options.exposeDocumentation ?? env.NODE_ENV !== 'production';
  const app = fastify({
    forceCloseConnections: 'idle',
    logger: false, // Usamos o logger pino customizado em src/utils/logger.ts
  });

  // Plugins
  app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW,
    keyGenerator: (request) =>
      isAuthorizedConsumer(request.headers.authorization)
        ? 'authorized-consumer'
        : `unauthorized:${request.ip}`,
    errorResponseBuilder: () => {
      return {
        statusCode: 429,
        success: false,
        message: `Limite de requisições excedido (${rateLimitMax} req/${env.RATE_LIMIT_TIME_WINDOW}). Tente novamente em breve.`,
      };
    },
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: 'API de Integração Duotalk–Syonet',
        description: 'API de integração de leads do Duotalk com o Syonet CRM via HTTP',
        version: '1.0.0',
      },
      servers: [
        {
          url: '{baseUrl}',
          variables: {
            baseUrl: {
              default: 'http://localhost:3000',
              description: 'Endereço base da API',
            },
          },
        },
      ],
      components: {
        securitySchemes: {
          consumerToken: {
            type: 'http',
            scheme: 'bearer',
            description: 'Token que autoriza o sistema consumidor a usar a API',
          },
        },
      },
    },
    transformObject: (document) => {
      if (!('openapiObject' in document)) return document.swaggerObject;
      const { openapiObject } = document;
      const leadOperation = openapiObject.paths?.['/leads']?.post;
      const parameters = leadOperation?.parameters;
      if (parameters) {
        leadOperation.parameters = parameters.filter(
          (parameter) => '$ref' in parameter || parameter.name !== 'sync',
        );
      }
      const requestBody = leadOperation?.requestBody;
      if (requestBody && !('$ref' in requestBody)) {
        const jsonContent = requestBody.content['application/json'];
        if (jsonContent) {
          const testHash = 'a1b2c3';
          jsonContent.example = {
            credentials: {
              url: 'https://seu-tenant.syonet.com',
              username: 'usuario-tecnico',
              password: 'senha',
            },
            target: { companyId: 25 },
            dryRun: true,
            daysToUpdateOpenEvent: 30,
            data: {
              id: `lead-${testHash}`,
              idConversa: `conversa-${testHash}`,
              origem: 'Outbound',
              canal: 'WhatsApp 360',
              qualificacaoLead: 'Lead',
              intermediario: 'Duotalk',
              operador: 'Operador Exemplo',
              nome: `Teste Duotalk ${testHash}`,
              telefone: '5561999998888',
              email: `teste.duotalk.${testHash}@example.com`,
              mensagem: 'Mensagem: Conversa criada manualmente',
              firstMessage: 'Olá, gostaria de conhecer os veículos disponíveis.',
              messageHistory: `(20/08/2026, 10:00:00) Teste Duotalk ${testHash}: Olá, gostaria de conhecer os veículos disponíveis.`,
              url_duotalk: `https://app.duotalk.io/apps/inbox/start-conversation?name=Teste%20Duotalk%20${testHash}&phone=5561999998888`,
              intencao: 'DVNU - Veículos Novos',
            },
          };
        }
      }
      return openapiObject;
    },
  });

  if (exposeDocumentation) {
    app.register(swaggerUi, {
      routePrefix: '/docs',
    });
  }

  // Registra as rotas HTTP
  app.register(leadRoutes);

  // Tratamento Global de Erros Zod
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
      logger.warn({ issues }, 'Erro de validação Zod no payload');
      return reply.status(400).send({
        success: false,
        message: 'Payload inválido',
        errors: error.format(),
      });
    }

    if (hasFastifyValidation(error)) {
      const issues = error.validation.map((issue) => ({
        path:
          issue.instancePath ||
          (typeof issue.params?.missingProperty === 'string' ? issue.params.missingProperty : ''),
        message: issue.message ?? 'Campo inválido',
      }));
      logger.warn({ issues }, 'Erro de validação Fastify no payload');
      return reply.status(400).send({
        success: false,
        message: 'Payload inválido',
        errors: issues,
      });
    }

    const clientErrorStatus = getClientErrorStatus(error);
    if (clientErrorStatus) {
      logger.warn({ statusCode: clientErrorStatus }, 'Requisição HTTP recusada');
      return reply.status(clientErrorStatus).send({
        success: false,
        message:
          clientErrorStatus === 429
            ? `Limite de requisições excedido (${rateLimitMax} req/${env.RATE_LIMIT_TIME_WINDOW}). Tente novamente em breve.`
            : clientErrorStatus === 413
              ? 'Payload excede o tamanho máximo permitido'
              : 'Requisição HTTP inválida',
      });
    }

    if (error instanceof QueueCapacityError) {
      logger.error('Requisição recusada porque a fila atingiu sua capacidade');
      return reply.status(503).send({
        success: false,
        message: 'Fila temporariamente sem capacidade; tente novamente mais tarde',
      });
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error({ error: errorMessage, stack: errorStack }, 'Erro interno não tratado');
    return reply.status(500).send({
      success: false,
      message: 'Erro interno do servidor',
    });
  });

  // Conectar o processador da fila à integração HTTP do Syonet
  if (env.QUEUE_ENABLED && options.startWorker !== false) {
    queueInstance.process(async (job) => processLeadJob(job));
  }

  return app;
}
