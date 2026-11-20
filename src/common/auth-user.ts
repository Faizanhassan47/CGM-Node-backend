import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** JWT principal attached by AuthGuard after a successful login/verify. */
export interface AuthUser {
  sub: number;
  email: string;
  tokenVersion?: number;
  /** Present when issued after email verification / social login. */
  emailVerified?: boolean;
}
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser =>
  context.switchToHttp().getRequest<{ user: AuthUser }>().user);
