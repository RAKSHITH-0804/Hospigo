import 'reflect-metadata';
import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { AUTHENTICATED_ONLY_KEY, REQUIRE_PERMISSION_KEY } from './permission.decorators';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function rewriteToTestDb(envKey: string): string {
  const raw = process.env[envKey];
  if (!raw) throw new Error(`${envKey} required`);
  const u = new URL(raw);
  u.pathname = '/hospigo_test';
  return u.toString();
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
  DATABASE_URL_OWNER: process.env.DATABASE_URL_OWNER_TEST || process.env.DATABASE_URL_OWNER,
  DATABASE_URL_HQ: rewriteToTestDb('DATABASE_URL_HQ'),
  DATABASE_URL_PATIENT: rewriteToTestDb('DATABASE_URL_PATIENT'),
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  JWT_HOSPITAL_ACCESS_SECRET:
    process.env.JWT_HOSPITAL_ACCESS_SECRET || 'test-hospital-access-secret-min-32-chars!!',
  JWT_HQ_ACCESS_SECRET:
    process.env.JWT_HQ_ACCESS_SECRET || 'test-hq-access-secret-min-32-characters!!',
  JWT_PATIENT_ACCESS_SECRET:
    process.env.JWT_PATIENT_ACCESS_SECRET || 'test-patient-access-secret-min-32-chars!!',
  OTP_HASH_SECRET: process.env.OTP_HASH_SECRET || 'test-otp-hash-secret-min-32-characters!!',
});

/**
 * Fails if any AppModule HTTP route lacks exactly one of
 * @Public / @AuthenticatedOnly / @RequirePermission.
 */
describe('Permission route scan', () => {
  it('every AppModule controller route has exactly one access marker', async () => {
    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const reflector = moduleRef.get(Reflector);
    const modules = moduleRef.get(ModulesContainer);

    const methodNames = Object.keys(RequestMethod).filter((k) => Number.isNaN(Number(k)));
    const violations: string[] = [];

    for (const nestModule of modules.values()) {
      for (const wrapper of nestModule.controllers.values()) {
        const instance = wrapper.instance;
        const metatype = wrapper.metatype;
        if (!instance || !metatype) continue;

        const controllerPath = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
        const proto = Object.getPrototypeOf(instance) as object;
        for (const key of Object.getOwnPropertyNames(proto)) {
          if (key === 'constructor') continue;
          const handler = (proto as Record<string, unknown>)[key];
          if (typeof handler !== 'function') continue;
          const method = Reflect.getMetadata(METHOD_METADATA, handler);
          if (method === undefined) continue;

          const routePath = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
          const methodLabel =
            methodNames.find((n) => RequestMethod[n as keyof typeof RequestMethod] === method) ??
            String(method);

          const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, metatype]);
          const permission = reflector.getAllAndOverride<unknown>(REQUIRE_PERMISSION_KEY, [
            handler,
            metatype,
          ]);
          const authenticatedOnly = reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, [
            handler,
            metatype,
          ]);
          const count = [Boolean(isPublic), Boolean(permission), Boolean(authenticatedOnly)].filter(
            Boolean,
          ).length;
          const full = `${methodLabel} /${[controllerPath, routePath]
            .filter((p) => p !== undefined && p !== null && String(p).length > 0)
            .join('/')
            .replace(/\/+/g, '/')}`;
          if (count !== 1) {
            violations.push(`${full} markers=${count}`);
          }
        }
      }
    }

    await moduleRef.close();
    expect(violations).toEqual([]);
  }, 60_000);
});
