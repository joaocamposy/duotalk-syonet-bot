import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  handleLeadRequest,
  getQueueStatus,
  getJobDetails,
} from '../controllers/lead-controller.js';
import { isAuthorizedConsumer } from '../auth/api-auth.js';

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
  required: [
    'clientCreated',
    'clientUpdated',
    'clientId',
    'companyId',
    'dryRun',
    'eventCreated',
    'eventId',
    'mapping',
  ],
  additionalProperties: false,
  properties: {
    clientCreated: { type: 'boolean' },
    clientUpdated: { type: 'boolean' },
    clientId: { type: ['number', 'null'] },
    companyId: { type: 'integer' },
    dryRun: { type: 'boolean' },
    eventCreated: { type: 'boolean' },
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

const syncTimeoutResponseSchema = {
  type: 'object',
  required: ['success', 'message', 'jobId', 'status'],
  properties: {
    success: { type: 'boolean', enum: [false] },
    message: { type: 'string' },
    jobId: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'processing'] },
  },
};

const directSuccessResponseSchema = {
  type: 'object',
  required: ['success', 'message', 'status', 'result'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    message: { type: 'string' },
    status: { type: 'string', enum: ['completed'] },
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
  fastify.post('/leads', {
    schema: {
      description:
        'Recebe os dados do lead do Duotalk e processa sincronamente por padrão. Para o modo assíncrono, habilite a fila e use POST /leads?sync=false',
      tags: ['Leads'],
      security: [{ consumerToken: [] }],
      querystring: {
        type: 'object',
        properties: {
          sync: {
            type: 'string',
            enum: ['true', 'false'],
            description:
              'Opcional. Quando omitido, processa sincronamente. false exige fila habilitada e responde 202',
          },
        },
      },
      body: {
        type: 'object',
        required: ['credentials', 'target', 'data'],
        properties: {
          dryRun: {
            type: 'boolean',
            description:
              'Controle de execução; true valida o fluxo sem executar POST ou PATCH no Syonet',
          },
          daysToUpdateOpenEvent: {
            type: 'integer',
            minimum: 0,
            description:
              'Quando maior que zero, reutiliza a oportunidade aberta mais recente do mesmo cliente, empresa, grupo e tipo dentro desta quantidade de dias e adiciona a nova observação como comentário',
          },
          credentials: {
            type: 'object',
            required: ['url', 'username', 'password'],
            properties: {
              url: { type: 'string', format: 'uri', description: 'URL HTTPS do Syonet' },
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
              id: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
                pattern: '^[^\\u0000-\\u001F\\u007F-\\u009F]+$',
              },
              idConversa: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
                pattern: '^[^\\u0000-\\u001F\\u007F-\\u009F]+$',
                description:
                  'Identidade idempotente da oportunidade; obrigatória quando dryRun não é true',
              },
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
            },
          },
        },
      },
      response: {
        200: describedResponse('Lead processado; resultado disponível', {
          anyOf: [jobAcceptanceResponseSchema, directSuccessResponseSchema],
        }),
        202: describedResponse(
          'Lead aceito para processamento em segundo plano',
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
          'Modo assíncrono indisponível, processador ausente ou fila temporariamente sem capacidade',
          basicErrorResponseSchema,
        ),
        504: describedResponse(
          'Prazo síncrono esgotado; job não cancelado e ainda pendente ou em processamento',
          syncTimeoutResponseSchema,
        ),
      },
    },
    preHandler: requireConsumerAuthorization,
    handler: handleLeadRequest,
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
