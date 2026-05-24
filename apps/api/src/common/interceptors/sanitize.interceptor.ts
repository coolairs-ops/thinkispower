import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SanitizeService } from '../../services/sanitize.service';

@Injectable()
export class SanitizeInterceptor implements NestInterceptor {
  constructor(private sanitizeService: SanitizeService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => this.sanitizeService.sanitizeResponseBody(data)),
    );
  }
}
