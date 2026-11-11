import { z } from 'zod';

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export const adminUsernameSchema = z
  .string()
  .trim()
  .min(1, '请输入用户名')
  .refine((value) => utf8ByteLength(value) <= 128, '用户名最多 128 字节')
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), '用户名不能包含控制字符');
