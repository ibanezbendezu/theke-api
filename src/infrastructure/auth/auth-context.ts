import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
export interface AuthContextValue { clerkUserId: string; email: string | null; displayName: string | null }
export const AuthContext = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContextValue => context.switchToHttp().getRequest().authContext);
