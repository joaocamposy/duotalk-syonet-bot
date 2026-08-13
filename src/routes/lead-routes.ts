import { FastifyInstance } from 'fastify';
import {
  handleDuotalkWebhook,
  getQueueStatus,
  getJobDetails,
} from '../controllers/lead-controller.js';

export async function leadRoutes(fastify: FastifyInstance): Promise<void> {
  // Webhook Duotalk
  fastify.post('/webhook/duotalk', {
    schema: {
      description:
        'Recebe os dados do lead do Duotalk / n8n e enfileira para gravação no Syonet CRM',
      tags: ['Webhook'],
      response: {
        202: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            jobId: { type: 'string' },
            status: { type: 'string' },
          },
        },
      },
    },
    handler: handleDuotalkWebhook,
  });

  // Healthcheck & Deep Status
  fastify.get('/health', {
    schema: {
      description: 'Healthcheck e métricas detalhadas da aplicação e da fila',
      tags: ['Status'],
    },
    handler: async (_req, reply) => {
      const queueStats = await getQueueStatusData();
      return reply.send({
        status: 'UP',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        queue: queueStats,
      });
    },
  });

  // Status da Fila
  fastify.get('/queue/status', {
    schema: {
      description: 'Estatísticas da fila de processamento de leads',
      tags: ['Fila'],
    },
    handler: getQueueStatus,
  });

  // Detalhes de um Job
  fastify.get('/queue/jobs/:id', {
    schema: {
      description: 'Consulta o status de um job específico por ID',
      tags: ['Fila'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
    },
    handler: getJobDetails,
  });
}

async function getQueueStatusData() {
  const { queueInstance } = await import('../queue/queue-manager.js');
  return queueInstance.getStats();
}
