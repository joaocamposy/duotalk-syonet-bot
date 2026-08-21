import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { queueInstance } from './queue/queue-manager.js';
import { closeGracefully } from './shutdown/graceful-shutdown.js';

const app = buildApp();
let isShuttingDown = false;

async function start() {
  try {
    const address = await app.listen({ port: env.PORT, host: env.HOST });
    logger.info({ address }, 'Servidor iniciado');
    if (env.NODE_ENV !== 'production') {
      logger.info({ documentationUrl: `${address}/docs` }, 'Documentação Swagger disponível');
    }
    if (env.QUEUE_ENABLED) logger.info(`⚙️  Driver de fila ativo: [${env.QUEUE_DRIVER}]`);
    else logger.info('Processamento síncrono direto ativo; fila desativada');
  } catch (err) {
    logger.fatal({ err }, 'Erro ao iniciar servidor Fastify');
    process.exit(1);
  }
}

// Graceful Shutdown
const handleShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Recebido sinal de encerramento, desligando graciosamente...');
  try {
    const { activeJobsDrained, stats } = await closeGracefully(
      app,
      queueInstance,
      env.SHUTDOWN_TIMEOUT_MS,
    );
    if (activeJobsDrained) logger.info('Servidor HTTP encerrado após concluir os jobs ativos');
    else logger.warn('Timeout ao aguardar a conclusão dos jobs durante o shutdown');
    if (stats.pending > 0) {
      const message =
        stats.driver === 'file'
          ? 'Jobs pendentes permaneceram persistidos para o próximo start'
          : 'Jobs pendentes da fila em memória serão perdidos no encerramento';
      logger.warn({ pending: stats.pending, driver: stats.driver }, message);
    }
    logger.flush();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Erro durante o graceful shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

start();
