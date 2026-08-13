import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const app = buildApp();

async function start() {
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info(`🚀 Servidor rodando em http://${env.HOST}:${env.PORT}`);
    logger.info(`📚 Documentação Swagger disponível em http://${env.HOST}:${env.PORT}/docs`);
    logger.info(`⚙️  Driver de fila ativo: [${env.QUEUE_DRIVER}]`);
  } catch (err) {
    logger.fatal({ err }, 'Erro ao iniciar servidor Fastify');
    process.exit(1);
  }
}

// Graceful Shutdown
const handleShutdown = async (signal: string) => {
  logger.info({ signal }, 'Recebido sinal de encerramento, desligando graciosamente...');
  try {
    await app.close();
    logger.info('Servidor HTTP encerrado com sucesso');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Erro durante o graceful shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

start();
