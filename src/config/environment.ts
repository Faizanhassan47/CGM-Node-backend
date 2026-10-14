import { plainToInstance } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, MinLength, validateSync } from 'class-validator';

class Environment {
  @IsString() DB_CONNECTION_STRING!: string;
  @IsString() @MinLength(32) JWT_SECRET!: string;
  @IsString() JWT_ISSUER = 'CGM.Api';
  @IsString() JWT_AUDIENCE = 'CGM.PatientApp';
  @IsInt() @Min(1) JWT_EXPIRY_MINUTES = 60;
  @IsInt() @Min(1) REFRESH_TOKEN_EXPIRY_DAYS = 30;
  @IsInt() @Min(1) API_PORT = 5232;
  @IsOptional() @IsString() CORS_ALLOWED_ORIGINS?: string;
}

export function validateEnvironment(values: Record<string, unknown>) {
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    typeof value === 'string' ? value.trim().replace(/^['"]|['"]$/g, '') : value,
  ]));
  for (const key of ['JWT_EXPIRY_MINUTES', 'REFRESH_TOKEN_EXPIRY_DAYS', 'API_PORT']) {
    if (typeof normalized[key] === 'string' && normalized[key] !== '') normalized[key] = Number(normalized[key]);
  }
  const config = plainToInstance(Environment, normalized, { enableImplicitConversion: true });
  const errors = validateSync(config, { skipMissingProperties: false });
  if (errors.length) throw new Error(errors.toString());
  return config;
}
