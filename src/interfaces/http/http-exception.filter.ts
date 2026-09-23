import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const request = host.switchToHttp().getRequest();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = exception instanceof HttpException ? exception.message : 'No se pudo completar la solicitud';
    const requestId = String(request.id ?? crypto.randomUUID());
    if (!(exception instanceof HttpException)) {
      const error = exception instanceof Error ? exception : new Error('Error no identificado');
      this.logger.error(`${requestId} ${error.message}`, error.stack);
    }
    response.header('x-request-id', requestId);
    response.status(status).send({ error: { code: status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED', message, requestId } });
  }
}
