import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // Local Internal-API serves HTTPS with a self-signed cert (SSL_PORT).
  if (process.env.INTERNAL_API_TLS_INSECURE === 'true') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      process.env.WEB_ORIGIN || '',
    ].filter(Boolean),
    credentials: true,
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
