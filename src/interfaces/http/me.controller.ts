import { Controller, Get, UseGuards } from '@nestjs/common';
import { AccountService } from '../../modules/account/account.service.js';
import { AuthContext, type AuthContextValue } from '../../infrastructure/auth/auth-context.js';
import { ClerkAuthGuard } from '../../infrastructure/auth/clerk-auth.guard.js';

@Controller('v1')
export class MeController {
  constructor(private readonly accounts: AccountService) {}
  @Get('me') @UseGuards(ClerkAuthGuard)
  async me(@AuthContext() auth: AuthContextValue) { return { data: await this.accounts.ensureLocalUser(auth) }; }
}
