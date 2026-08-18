import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  handleDuotalkWebhook,
  getQueueStatus,
  getJobDetails,
} from '../controllers/lead-controller.js';
import { isAuthorizedConsumer } from '../auth/microservice-auth.js';

const basicErrorResponseSchema = {
  type: 'object',
  required: ['success', 'message'],
  properties: {
    success: { type: 'boolean' },
    message: { type: 'string' },
  },
};

const requestErrorResponseSchema = {
  type: 'object',
  required: ['success', 'message'],
  properties: {
    success: { type: 'boolean' },
    message: { type: 'string' },
    errors: {},
    errorCode: { type: 'string' },
    jobId: { type: 'string' },
    status: { type: 'string' },
  },
};

const jobResultSchema = {
  type: 'object',
  properties: {
    clientCreated: { type: 'boolean' },
    clientId: { type: ['number', 'null'] },
    companyId: { type: 'integer' },
    dryRun: { type: 'boolean' },
    eventId: { type: ['number', 'null'] },
    mapping: {
      type: 'object',
      required: ['contactForm', 'eventGroupId', 'eventTypeId', 'media'],
      properties: {
        contactForm: { type: 'string' },
        eventGroupId: { type: 'string' },
        eventTypeId: { type: 'string' },
        media: { type: 'string' },
      },
    },
  },
};

const jobAcceptanceResponseSchema = {
  type: 'object',
  required: ['success', 'message', 'jobId', 'status'],
  properties: {
    success: { type: 'boolean' },
    message: { type: 'string' },
    jobId: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
    duplicate: { type: 'boolean' },
    errorCode: { type: 'string' },
    result: jobResultSchema,
  },
};

function describedResponse(description: string, schema: Record<string, unknown>) {
  return { description, ...schema };
}

async function requireConsumerAuthorization(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!isAuthorizedConsumer(request.headers.authorization)) {
    return reply.status(401).send({ success: false, message: 'Consumidor não autorizado' });
  }
}

export async function leadRoutes(fastify: FastifyInstance): Promise<void> {
  // Webhook Duotalk
  fastify.post('/webhook/duotalk', {
    schema: {
      description: 'Recebe os dados do lead do Duotalk e enfileira para gravação no Syonet CRM',
      tags: ['Webhook'],
      security: [{ consumerToken: [] }],
      querystring: {
        type: 'object',
        properties: {
          sync: {
            type: 'string',
            enum: ['true', 'false'],
            description: 'Aguarda o job até SYNC_TIMEOUT_MS quando igual a true',
          },
        },
      },
      body: {
        type: 'object',
        required: ['credentials', 'target', 'data'],
        properties: {
          credentials: {
            type: 'object',
            required: ['url', 'username', 'password'],
            properties: {
              url: { type: 'string', format: 'uri', description: 'Origem HTTPS autorizada' },
              username: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
                description: 'Compartilha com a senha o limite de tamanho do payload RSA',
              },
              password: {
                type: 'string',
                minLength: 1,
                maxLength: 500,
                writeOnly: true,
                description: 'Compartilha com o usuário o limite de tamanho do payload RSA',
              },
              version: { type: 'string', minLength: 1, maxLength: 100 },
            },
          },
          target: {
            type: 'object',
            required: ['companyId'],
            additionalProperties: false,
            properties: {
              companyId: { type: 'integer', minimum: 1 },
            },
          },
          data: {
            type: 'object',
            required: ['nome', 'telefone'],
            additionalProperties: true,
            properties: {
              id: { type: 'string', maxLength: 200 },
              idConversa: { type: 'string', maxLength: 200 },
              origem: { type: 'string', minLength: 1, maxLength: 100 },
              canal: { type: 'string', minLength: 1, maxLength: 100 },
              qualificacaoLead: { type: 'string', minLength: 1, maxLength: 100 },
              intermediario: { type: 'string', minLength: 1, maxLength: 100 },
              operador: { type: 'string', maxLength: 150 },
              nome: { type: 'string', minLength: 1, maxLength: 150 },
              telefone: { type: 'string', minLength: 10, maxLength: 30 },
              email: { type: 'string', format: 'email', maxLength: 254 },
              mensagem: { type: 'string', maxLength: 10000 },
              firstMessage: { type: 'string', maxLength: 10000 },
              messageHistory: { type: 'string', maxLength: 50000 },
              url_duotalk: { type: 'string', maxLength: 2048 },
              intencao: { type: 'string', maxLength: 200 },
              dryRun: { type: 'boolean' },
            },
          },
        },
      },
      response: {
        200: describedResponse('Processamento concluído com sucesso', jobAcceptanceResponseSchema),
        202: describedResponse(
          'Job aceito ou já existente e ainda em processamento',
          jobAcceptanceResponseSchema,
        ),
        400: describedResponse('Payload ou requisição inválida', requestErrorResponseSchema),
        401: describedResponse('Token de acesso ausente ou inválido', basicErrorResponseSchema),
        409: describedResponse(
          'Job duplicado com falha que exige conciliação',
          jobAcceptanceResponseSchema,
        ),
        422: describedResponse('Unidade ou mapeamento incompatível', requestErrorResponseSchema),
        429: describedResponse('Limite de requisições excedido', basicErrorResponseSchema),
        500: describedResponse(
          'Erro interno ao processar a requisição',
          requestErrorResponseSchema,
        ),
        503: describedResponse(
          'Fila ou processamento temporariamente indisponível',
          basicErrorResponseSchema,
        ),
      },
    },
    preHandler: requireConsumerAuthorization,
    handler: handleDuotalkWebhook,
  });

  // Healthcheck público sem detalhes internos
  fastify.get('/health', {
    config: { rateLimit: false },
    schema: {
      description: 'Healthcheck básico da aplicação',
      tags: ['Status'],
      response: {
        200: describedResponse('Serviço operacional', {
          type: 'object',
          required: ['status', 'timestamp', 'uptime'],
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number' },
          },
        }),
      },
    },
    handler: async (_req, reply) => {
      return reply.send({
        status: 'UP',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    },
  });

  // Status da Fila
  fastify.get('/queue/status', {
    schema: {
      description: 'Estatísticas da fila de processamento de leads',
      tags: ['Fila'],
      security: [{ consumerToken: [] }],
      response: {
        200: describedResponse('Estatísticas da fila obtidas com sucesso', {
          type: 'object',
          required: ['success', 'stats'],
          properties: {
            success: { type: 'boolean' },
            stats: {
              type: 'object',
              properties: {
                pending: { type: 'integer' },
                processing: { type: 'integer' },
                completed: { type: 'integer' },
                failed: { type: 'integer' },
                total: { type: 'integer' },
                driver: { type: 'string' },
              },
            },
          },
        }),
        401: describedResponse('Token de acesso ausente ou inválido', basicErrorResponseSchema),
        429: describedResponse('Limite de requisições excedido', basicErrorResponseSchema),
      },
    },
    preHandler: requireConsumerAuthorization,
    handler: getQueueStatus,
  });

  // Detalhes de um Job
  fastify.get('/queue/jobs/:id', {
    schema: {
      description: 'Consulta o status de um job específico por ID',
      tags: ['Fila'],
      security: [{ consumerToken: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
      response: {
        200: describedResponse('Status do job obtido com sucesso', {
          type: 'object',
          required: ['success', 'job'],
          properties: {
            success: { type: 'boolean' },
            job: {
              type: 'object',
              required: ['id', 'status', 'attempts', 'maxAttempts', 'createdAt', 'updatedAt'],
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                status: {
                  type: 'string',
                  enum: ['pending', 'processing', 'completed', 'failed'],
                },
                attempts: { type: 'integer' },
                maxAttempts: { type: 'integer' },
                errorCode: { type: 'string' },
                result: jobResultSchema,
                createdAt: { type: 'string', format: 'date-time' },
                updatedAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        }),
        401: describedResponse('Token de acesso ausente ou inválido', basicErrorResponseSchema),
        429: describedResponse('Limite de requisições excedido', basicErrorResponseSchema),
        404: describedResponse('Job não encontrado', basicErrorResponseSchema),
      },
    },
    preHandler: requireConsumerAuthorization,
    handler: getJobDetails,
  });
}
