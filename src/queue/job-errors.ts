export class NonRetryableJobError extends Error {
  readonly code?: string;

  constructor(message: string, options?: ErrorOptions & { code?: string }) {
    super(message, options);
    this.name = 'NonRetryableJobError';
    this.code = options?.code;
  }
}

export class QueueCapacityError extends Error {
  constructor(message = 'A fila atingiu sua capacidade máxima') {
    super(message);
    this.name = 'QueueCapacityError';
  }
}
