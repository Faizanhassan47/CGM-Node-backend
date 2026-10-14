import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser { sub: number; email: string; tokenVersion?: number; }
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser =>
  context.switchToHttp().getRequest<{ user: AuthUser }>().user);
