import { z } from 'zod';

export const LoginResponseDataSchema = z.object({
  processId: z.string(),
  countdownInSeconds: z.number(),
  ['2fa']: z.string(),
});

export type LoginResponseData = z.infer<typeof LoginResponseDataSchema>;

export const LoginResponseSchema = z.object({
  data: LoginResponseDataSchema,
  cookies: z.array(z.string()),
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
