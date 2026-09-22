import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from '@nestjs/common';
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const request = host.switchToHttp().getRequest();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = exception instanceof HttpException ? exception.message : 'No se pudo completar la solicitud';
    const requestId = String(request.id ?? crypto.randomUUID());
    response.header('x-request-id', requestId);
    response.status(status).send({ error: { code: status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED', message, requestId } });
  }
}
