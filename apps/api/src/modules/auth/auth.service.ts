import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import {
  AuthLoginResult,
  AuthLoginSuccess,
  AuthUser,
  isMfaChallenge,
} from '@kiswok/shared';
import { JwtPayload, userFromJwt } from './auth.types';

type InternalEnvelope<T> = {
  status?: number;
  success?: boolean;
  message?: string;
  data?: T;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly config: ConfigService) {
    // ConfigModule loads .env after process start; apply here so self-signed
    // Internal-API HTTPS is accepted even if main.ts ran before dotenv.
    if (this.config.get<string>('INTERNAL_API_TLS_INSECURE') === 'true') {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  private internalBase(): string {
    const base =
      this.config.get<string>('INTERNAL_API_URL') ||
      'https://testv2.kiswok.com/api';
    return base.replace(/\/$/, '').replace('://localhost', '://127.0.0.1');
  }

  private jwtSecret(): string | undefined {
    return this.config.get<string>('JWT_SECRET') || undefined;
  }

  private encodeCredential(value: string, alreadyEncoded?: boolean): string {
    if (alreadyEncoded) return value;
    return Buffer.from(value, 'utf8').toString('base64');
  }

  private async proxyJson<T>(
    path: string,
    init?: RequestInit & { token?: string },
  ): Promise<InternalEnvelope<T>> {
    const url = `${this.internalBase()}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (init?.token) {
      headers.Authorization = `Bearer ${init.token}`;
    }

    const attempts = 3;
    let res: Response | undefined;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        res = await fetch(url, {
          method: init?.method || 'GET',
          headers,
          body: init?.body,
        });
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        this.logger.warn(
          `Internal-API attempt ${attempt}/${attempts} failed: ${url} — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        if (attempt < attempts) {
          await sleep(250 * attempt);
        }
      }
    }
    if (!res) {
      this.logger.error(`Internal-API unreachable: ${url}`, lastErr as Error);
      throw new BadGatewayException(
        `Unable to reach Internal-API at ${this.internalBase()} — start Internal-API or set INTERNAL_API_URL (VPN may be required)`,
      );
    }

    let body: InternalEnvelope<T>;
    try {
      body = (await res.json()) as InternalEnvelope<T>;
    } catch {
      throw new BadGatewayException(
        `Internal-API returned non-JSON (${res.status})`,
      );
    }

    if (!res.ok || body.success === false) {
      const message =
        typeof body.message === 'string'
          ? body.message
          : `Authentication failed (${res.status})`;
      if (res.status >= 500) {
        throw new BadGatewayException(message);
      }
      throw new UnauthorizedException(message);
    }

    return body;
  }

  async login(
    username: string,
    password: string,
    encoded?: boolean,
  ): Promise<AuthLoginResult> {
    const payload = {
      username: this.encodeCredential(username, encoded),
      password: this.encodeCredential(password, encoded),
    };

    const envelope = await this.proxyJson<AuthLoginResult>(
      '/kiswok/auth/login',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (!envelope.data) {
      throw new UnauthorizedException(envelope.message || 'Login failed');
    }
    return envelope.data;
  }

  async verifyOtp(empId: string, otp: string): Promise<AuthLoginSuccess> {
    const qs = new URLSearchParams({ empId, otp });
    const envelope = await this.proxyJson<AuthLoginSuccess>(
      `/kiswok/auth/verifyOTP?${qs.toString()}`,
      { method: 'POST' },
    );
    if (!envelope.data?.accessToken) {
      throw new UnauthorizedException(envelope.message || 'OTP verification failed');
    }
    return envelope.data;
  }

  async forgotPassword(empCode: string, loginId: string) {
    const qs = new URLSearchParams({ empCode, loginId });
    const envelope = await this.proxyJson<Record<string, unknown>>(
      `/kiswok/auth/forget-password?${qs.toString()}`,
    );
    return {
      message: envelope.message || 'OTP sent',
      data: envelope.data ?? {},
    };
  }

  async resetPassword(body: {
    empId: string;
    loginId: string;
    otp: string;
    newPassword: string;
    confirmPassword: string;
  }) {
    const envelope = await this.proxyJson<unknown>(
      '/kiswok/auth/reset-request',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    return { message: envelope.message || 'Password reset successfully' };
  }

  verifyAccessToken(token: string): JwtPayload {
    const secret = this.jwtSecret();
    if (!secret) {
      throw new UnauthorizedException(
        'JWT_SECRET is not configured on V3 API — copy from Internal-API .env',
      );
    }
    try {
      return jwt.verify(token, secret) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  async me(token: string): Promise<AuthUser> {
    const secret = this.jwtSecret();
    if (secret) {
      return userFromJwt(this.verifyAccessToken(token));
    }

    const envelope = await this.proxyJson<AuthUser>('/user/profile', {
      token,
    });
    if (!envelope.data) {
      throw new UnauthorizedException('Session is not valid');
    }
    return envelope.data;
  }

  assertLoginSuccess(data: AuthLoginResult): AuthLoginSuccess {
    if (isMfaChallenge(data)) {
      throw new UnauthorizedException('MFA verification required');
    }
    return data;
  }
}
