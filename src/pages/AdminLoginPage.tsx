import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { isMockMode } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import { useAuth } from '../context/AuthContext';

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, '请输入管理员用户名')
    .max(128, '用户名最长 128 字符 (openapi.json LoginInput)'),
  password: z
    .string()
    .min(1, '请输入管理员密码')
    .max(72, '密码最长 72 字节 (bcrypt 上限，openapi.json LoginInput)'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function AdminLoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitError, setSubmitError] = useState<unknown>(null);

  const fromPath =
    (location.state as { from?: string } | null)?.from || '/admin/keyboxes';

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError(null);
    try {
      const res = await login(values);
      toast.success(`管理员 ${res.admin.username} 登录成功`);
      navigate(fromPath, { replace: true });
    } catch (err) {
      setSubmitError(err);
    }
  };

  return (
    <div className="mx-auto max-w-md py-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <Lock className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">管理员安全登录</h1>
            <p className="text-xs text-slate-500">
              POST /api/v1/admin/login · HttpOnly 会话 Cookie
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>认证与存储安全规范：</span>
          </div>
          <p className="mt-1 leading-relaxed">
            登录成功后由服务端下发 <code className="font-mono">__Host-keybox_session</code>{' '}
            (<code className="font-mono">Secure; HttpOnly; SameSite=Strict</code>，8 小时绝对有效期)。
            前端<strong>绝不在 localStorage 或 sessionStorage 中保存任何令牌</strong>，仅在内存中维护当前会话的{' '}
            <code className="font-mono">X-CSRF-Token</code>。
          </p>
        </div>

        {submitError ? (
          <div className="mt-4">
            <ErrorBanner error={submitError} />
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-5 space-y-4"
          noValidate
          data-testid="admin-login-form"
        >
          <div>
            <label
              htmlFor="admin-username"
              className="block text-xs font-semibold text-slate-700"
            >
              管理员用户名 (username)
            </label>
            <input
              id="admin-username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-testid="login-username-input"
              {...register('username')}
              placeholder="输入管理员账号"
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
            />
            {errors.username && (
              <p className="mt-1 text-xs text-rose-600" role="alert">
                {errors.username.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="admin-password"
              className="block text-xs font-semibold text-slate-700"
            >
              管理员密码 (password)
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              data-testid="login-password-input"
              {...register('password')}
              placeholder="输入管理员密码（最长 72 字节）"
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-rose-600" role="alert">
                {errors.password.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            data-testid="login-submit-btn"
            className="btn-interactive flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
          >
            <KeyRound className="h-4 w-4" />
            <span>{isSubmitting ? '正在验证凭据…' : '登录管理后台'}</span>
          </button>
        </form>

        {isMockMode() && (
          <div className="mt-5 border-t border-slate-100 pt-4 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700">
              <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
              <span>Mock 模式快速填充测试：</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setValue('username', 'secops_admin');
                  setValue('password', 'StrongAdminPass#2026');
                }}
                className="btn-interactive rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-900 hover:bg-emerald-100"
              >
                填充有效管理员凭据
              </button>
              <button
                type="button"
                onClick={() => {
                  setValue('username', 'secops_admin');
                  setValue('password', 'wrong');
                }}
                className="btn-interactive rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 font-medium text-rose-900 hover:bg-rose-100"
              >
                模拟 401 凭据错误
              </button>
              <button
                type="button"
                onClick={() => {
                  setValue('username', 'ratelimit');
                  setValue('password', 'ratelimit');
                }}
                className="btn-interactive rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100"
              >
                模拟 429 登录限流
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
