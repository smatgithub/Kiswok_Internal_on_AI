import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

function isPrivateLanHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function isAllowedWebOrigin(origin?: string): boolean {
  if (!origin) return true;
  const extras = (process.env.WEB_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (extras.includes(origin)) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol === 'https:' &&
      (host === 'kiswok.com' || host.endsWith('.kiswok.com'))
    ) {
      return true;
    }
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return isPrivateLanHost(host) && port === '3000';
  } catch {
    return false;
  }
}

async function bootstrap() {
  // Local Internal-API serves HTTPS with a self-signed cert (SSL_PORT).
  if (process.env.INTERNAL_API_TLS_INSECURE === 'true') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (isAllowedWebOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    exposedHeaders: [
      'Content-Disposition',
      'X-SAP-Regenerated',
      'X-SAP-Export-Format',
      'X-SAP-Excluded-Count',
      'X-SAP-Excluded-Sample',
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  const port = Number(process.env.API_PORT || 4010);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Kiswok Internal V3 API listening on :${port}`);
}

bootstrap();
