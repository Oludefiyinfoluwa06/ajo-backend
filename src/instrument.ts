import { config } from 'dotenv';
import * as Sentry from '@sentry/nestjs';

config();

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  dataCollection: {},
});
