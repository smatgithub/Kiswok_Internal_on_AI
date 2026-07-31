import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './dto/login.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthUser } from './auth.types';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(@Body() body: LoginDto) {
    const data = await this.auth.login(
      body.username,
      body.password,
      body.encoded,
    );
    return {
      success: true,
      message: 'requiredMFA' in data && data.requiredMFA
        ? 'OTP has been sent to your registered contact methods'
        : 'Login successful',
      data,
    };
  }

  @Post('verify-otp')
  async verifyOtp(@Body() body: VerifyOtpDto) {
    const data = await this.auth.verifyOtp(body.empId, body.otp);
    return {
      success: true,
      message: 'OTP verified successfully',
      data,
    };
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    const result = await this.auth.forgotPassword(body.empCode, body.loginId);
    return {
      success: true,
      message: result.message,
      data: result.data,
    };
  }

  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto) {
    const result = await this.auth.resetPassword(body);
    return {
      success: true,
      message: result.message,
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return { success: true, data: user };
  }

  @Post('logout')
  logout() {
    // V2 clears client storage only; refresh cookie lives on Internal-API domain.
    return {
      success: true,
      message: 'Logged out',
    };
  }

  @Get('session')
  async session(@Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Not authenticated');
    }
    const token = authorization.slice('Bearer '.length).trim();
    const user = await this.auth.me(token);
    return { success: true, data: user };
  }
}
